import type { LedState, PatchMode, PatchPreset } from '../data/patch-states.ts';
import { getInlinedFaceplateLayers } from '../lib/panel-layers-inline.ts';
import {
  PANEL_CONTROL_COORDS,
  PANEL_VIEWBOX,
  describeSweepArc,
  tickToDeg,
  type PanelControlId,
} from '../lib/panel-svg-shared.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined | null> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      el.setAttribute(key, String(value));
    }
  }
  return el;
}

interface LedVisual {
  core: string;
  rim: string;
  glowOpacity: string;
  label: string;
}

function ledStyleForState(state: LedState): LedVisual {
  switch (state) {
    case 'bright-green':
      return { core: '#4ADE80', rim: '#22C55E', glowOpacity: '0.9', label: 'Bright Green (+V)' };
    case 'green':
      return { core: '#4ADE80', rim: '#16A34A', glowOpacity: '0.72', label: 'Green (+V)' };
    case 'red':
      return { core: '#F87171', rim: '#EF4444', glowOpacity: '0.78', label: 'Steady Red (−V)' };
    case 'dim-red':
      return { core: '#EF4444', rim: '#991B1B', glowOpacity: '0.42', label: 'Dim Red (−V)' };
    case 'amber':
      return { core: '#FBBF24', rim: '#D97706', glowOpacity: '0.8', label: 'Blended Amber (±V)' };
    case 'dark':
    default:
      return { core: '#1B1E25', rim: '#363B47', glowOpacity: '0', label: 'Dark (0.00 V)' };
  }
}

const SHADOW_STYLES = `
:host {
  display: block;
  aspect-ratio: 30 / 128.5;
  inline-size: 100%;
  user-select: none;
}
svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}
.knob-rotator {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ctrl-group {
  transition: opacity 160ms ease;
}
.ctrl-group.is-dimmed {
  opacity: 0.28;
}
.ctrl-interactive {
  cursor: pointer;
  outline: none;
}
.ctrl-hit-ring {
  fill: transparent;
  stroke: transparent;
  stroke-width: 0.55;
  transition: stroke 140ms ease, fill 140ms ease;
}
.ctrl-interactive:hover .ctrl-hit-ring,
.ctrl-interactive:focus-visible .ctrl-hit-ring {
  stroke: #E2BE66;
  fill: rgba(216, 177, 84, 0.12);
}
.ctrl-group.is-highlighted .ctrl-hit-ring,
.ctrl-group.is-locked .ctrl-hit-ring {
  stroke: #E2BE66;
  stroke-width: 0.65;
  fill: rgba(216, 177, 84, 0.16);
}
.ctrl-group.is-mandatory-alert .ctrl-hit-ring {
  stroke: #F87171;
  stroke-width: 0.65;
}
@media (prefers-reduced-motion: reduce) {
  .knob-rotator,
  .ctrl-group,
  .ctrl-hit-ring {
    transition: none;
  }
}
@media (forced-colors: active) {
  .panel-substrate {
    stroke: CanvasText;
    stroke-width: 0.45;
  }
  .ctrl-interactive:focus-visible .ctrl-hit-ring,
  .ctrl-group.is-highlighted .ctrl-hit-ring,
  .ctrl-group.is-locked .ctrl-hit-ring {
    stroke: Highlight;
  }
}
@media print {
  .ctrl-hit-ring {
    stroke-width: 0.4;
  }
}
`;

export class EnvSkewPanel extends HTMLElement {
  #root: ShadowRoot;
  #preset: PatchPreset | null = null;
  #mode: PatchMode = 'envelope-follower';
  #signalState: 'idle' | 'active' = 'idle';
  #activeControl: PanelControlId | null = null;
  #lockedControl: PanelControlId | null = null;
  #svgBuilt = false;
  #controlGroups = new Map<PanelControlId, SVGGElement>();
  #normalArrowEl: Element | null = null;
  #normalBreakEl: SVGGElement | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes(): string[] {
    return ['signal-state', 'active-control', 'locked-control'];
  }

  connectedCallback(): void {
    const attrSignal = this.getAttribute('signal-state');
    if (attrSignal === 'active' || attrSignal === 'idle') {
      this.#signalState = attrSignal;
    }
    this.#activeControl = (this.getAttribute('active-control') as PanelControlId | null) || this.#activeControl;
    this.#lockedControl = (this.getAttribute('locked-control') as PanelControlId | null) || this.#lockedControl;

    if (!this.#svgBuilt) {
      this.#buildBaseDom();
    }
    this.#renderState();
  }

  attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
    if (name === 'signal-state') {
      this.#signalState = newVal === 'active' ? 'active' : 'idle';
    } else if (name === 'active-control') {
      this.#activeControl = (newVal as PanelControlId | null) || null;
    } else if (name === 'locked-control') {
      this.#lockedControl = (newVal as PanelControlId | null) || null;
    }
    this.#renderState();
  }

  get preset(): PatchPreset | null {
    return this.#preset;
  }

  set preset(val: PatchPreset | null) {
    this.#preset = val;
    this.#renderState();
  }

  get mode(): PatchMode {
    return this.#mode;
  }

  get signalState(): 'idle' | 'active' {
    return this.#signalState;
  }

  set signalState(val: 'idle' | 'active') {
    this.setSignalState(val);
  }

  setPreset(preset: PatchPreset, mode?: PatchMode): void {
    this.#preset = preset;
    if (mode) {
      this.#mode = mode;
    } else {
      this.#mode =
        preset.knobs.gain.bypassed || preset.jacks.slewIn.state === 'active'
          ? 'asymmetric-skew-limiter'
          : 'envelope-follower';
    }
    this.#renderState();
  }

  setSignalState(state: 'idle' | 'active'): void {
    this.#signalState = state === 'active' ? 'active' : 'idle';
    if (this.getAttribute('signal-state') !== this.#signalState) {
      this.setAttribute('signal-state', this.#signalState);
    }
    this.#renderState();
  }

  setActiveControl(id: PanelControlId | null): void {
    this.#activeControl = id;
    this.#renderState();
  }

  setLockedControl(id: PanelControlId | null): void {
    this.#lockedControl = id;
    this.#renderState();
  }

  #buildBaseDom(): void {
    this.#svgBuilt = true;
    const style = document.createElement('style');
    style.textContent = SHADOW_STYLES;

    const svg = svgEl('svg', {
      viewBox: PANEL_VIEWBOX,
      role: 'group',
      'aria-label': 'ENV / SKEW interactive 6 HP front panel',
    });

    const defs = svgEl('defs');
    const ledGlow = svgEl('radialGradient', {
      id: 'panel-led-glow',
      cx: '50%',
      cy: '50%',
      r: '50%',
    });
    ledGlow.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#4ADE80', 'stop-opacity': '0.95' }),
      svgEl('stop', { offset: '55%', 'stop-color': '#4ADE80', 'stop-opacity': '0.4' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#4ADE80', 'stop-opacity': '0' }),
    );

    const knobGrad = svgEl('radialGradient', {
      id: 'panel-knob-cap',
      cx: '38%',
      cy: '35%',
      r: '65%',
    });
    knobGrad.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#2E3340' }),
      svgEl('stop', { offset: '75%', 'stop-color': '#191B22' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#101115' }),
    );

    const nutGrad = svgEl('radialGradient', {
      id: 'panel-jack-nut',
      cx: '40%',
      cy: '35%',
      r: '70%',
    });
    nutGrad.append(
      svgEl('stop', { offset: '0%', 'stop-color': '#585E6E' }),
      svgEl('stop', { offset: '100%', 'stop-color': '#252932' }),
    );

    defs.append(ledGlow, knobGrad, nutGrad);
    svg.append(defs);

    // Matte Black FR4 substrate + Doepfer NPTH mounting slots
    const bgGroup = svgEl('g', { class: 'panel-bg' });
    bgGroup.append(
      svgEl('rect', {
        class: 'panel-substrate',
        x: '0',
        y: '0',
        width: '30',
        height: '128.5',
        rx: '0.4',
        fill: '#141518',
        stroke: '#2A2E38',
        'stroke-width': '0.25',
      }),
    );

    for (const cy of [3.0, 125.5]) {
      bgGroup.append(
        svgEl('rect', {
          x: (7.5 - 2.95).toFixed(2),
          y: (cy - 1.8).toFixed(2),
          width: '5.9',
          height: '3.6',
          rx: '1.8',
          fill: '#262A34',
          stroke: '#464C5C',
          'stroke-width': '0.18',
        }),
        svgEl('rect', {
          x: (7.5 - 2.75).toFixed(2),
          y: (cy - 1.6).toFixed(2),
          width: '5.5',
          height: '3.2',
          rx: '1.6',
          fill: '#090A0D',
        }),
      );
    }

    // Inlined F.Mask ENIG Gold + F.SilkS White layers (omitting registration frame)
    const faceplateHost = svgEl('g', { class: 'faceplate-layers' });
    const { goldLayerSvg, silkLayerSvg } = getInlinedFaceplateLayers();
    const parser = new DOMParser();
    const layersDoc = parser.parseFromString(
      `<svg xmlns="${SVG_NS}">${goldLayerSvg}${silkLayerSvg}</svg>`,
      'image/svg+xml',
    );
    const goldNode = layersDoc.getElementById('_01_F_Mask_Gold');
    const silkNode = layersDoc.getElementById('_02_F_SilkS_White');
    if (goldNode) {
      const importedGold = document.importNode(goldNode, true) as Element;
      this.#normalArrowEl = importedGold.querySelector('[data-normal-arrow="true"]');
      faceplateHost.append(importedGold);
    }
    if (silkNode) {
      faceplateHost.append(document.importNode(silkNode, true));
    }

    // Normaling break slash (×) centered at (15.0, 95.75) between J1 IN and J2 SLEW IN
    const normalBreak = svgEl('g', {
      class: 'normal-break-overlay',
      opacity: '0',
    });
    normalBreak.append(
      svgEl('line', {
        x1: '13.9',
        y1: '94.65',
        x2: '16.1',
        y2: '96.85',
        stroke: '#F87171',
        'stroke-width': '0.55',
        'stroke-linecap': 'round',
      }),
      svgEl('line', {
        x1: '16.1',
        y1: '94.65',
        x2: '13.9',
        y2: '96.85',
        stroke: '#F87171',
        'stroke-width': '0.55',
        'stroke-linecap': 'round',
      }),
    );
    this.#normalBreakEl = normalBreak;

    const controlsLayer = svgEl('g', { class: 'controls-layer' });

    for (const [rawId, meta] of Object.entries(PANEL_CONTROL_COORDS)) {
      const id = rawId as PanelControlId;
      const g = svgEl('g', {
        class: 'ctrl-group ctrl-interactive',
        'data-control': id,
        role: 'button',
        tabindex: '0',
        'aria-label': meta.label,
        'aria-pressed': 'false',
      });

      const ringRadius =
        meta.kind === 'pot' ? 6.55 : meta.kind === 'jack' ? 4.45 : meta.kind === 'led' ? 3.55 : 3.7;
      g.append(
        svgEl('circle', {
          class: 'ctrl-hit-ring',
          cx: meta.x,
          cy: meta.y,
          r: ringRadius,
        }),
      );

      if (meta.kind === 'pot') {
        const arc = svgEl('path', {
          class: 'knob-range-arc',
          fill: 'none',
          stroke: '#E2BE66',
          'stroke-width': '0.95',
          'stroke-linecap': 'round',
          opacity: '0',
        });
        const bezel = svgEl('circle', {
          cx: meta.x,
          cy: meta.y,
          r: '4.75',
          fill: '#0B0C0F',
          stroke: '#3A3F4D',
          'stroke-width': '0.22',
        });
        const cap = svgEl('circle', {
          cx: meta.x,
          cy: meta.y,
          r: '4.35',
          fill: 'url(#panel-knob-cap)',
          stroke: '#484F61',
          'stroke-width': '0.2',
        });
        const rotator = svgEl('g', {
          class: 'knob-rotator',
          style: `transform-origin: ${meta.x}px ${meta.y}px`,
        });
        rotator.append(
          svgEl('line', {
            class: 'knob-pointer',
            x1: meta.x,
            y1: meta.y - 1.1,
            x2: meta.x,
            y2: meta.y - 4.15,
            stroke: '#F4F5F7',
            'stroke-width': '0.95',
            'stroke-linecap': 'round',
          }),
          svgEl('circle', { cx: meta.x, cy: meta.y, r: '0.85', fill: '#303542' }),
        );

        const bypassBadge = svgEl('g', { class: 'bypass-overlay', opacity: '0' });
        const bypassLabel = svgEl('text', {
          x: meta.x,
          y: meta.y + 0.65,
          'text-anchor': 'middle',
          'font-family': 'IBM Plex Mono, monospace',
          'font-size': '1.85',
          'font-weight': '700',
          fill: '#F87171',
        });
        bypassLabel.textContent = 'BYPASS';

        bypassBadge.append(
          svgEl('line', {
            x1: meta.x - 4.0,
            y1: meta.y + 4.0,
            x2: meta.x + 4.0,
            y2: meta.y - 4.0,
            stroke: '#F87171',
            'stroke-width': '0.65',
            'stroke-linecap': 'round',
          }),
          svgEl('rect', {
            x: meta.x - 5.2,
            y: meta.y - 1.35,
            width: '10.4',
            height: '2.7',
            rx: '0.5',
            fill: '#2C1416',
            stroke: '#F87171',
            'stroke-width': '0.22',
          }),
          bypassLabel,
        );
        g.append(arc, bezel, cap, rotator, bypassBadge);
      } else if (meta.kind === 'switch') {
        const nut = svgEl('circle', {
          cx: meta.x,
          cy: meta.y,
          r: '2.55',
          fill: 'url(#panel-jack-nut)',
          stroke: '#6C7387',
          'stroke-width': '0.25',
        });
        const bore = svgEl('circle', { cx: meta.x, cy: meta.y, r: '1.2', fill: '#0B0C0F' });
        const batShadow = svgEl('line', {
          class: 'toggle-bat-shadow',
          x1: meta.x,
          y1: meta.y,
          x2: meta.x,
          y2: meta.y - 2.55,
          stroke: '#090A0D',
          'stroke-width': '1.9',
          'stroke-linecap': 'round',
        });
        const bat = svgEl('line', {
          class: 'toggle-bat',
          x1: meta.x,
          y1: meta.y,
          x2: meta.x,
          y2: meta.y - 2.55,
          stroke: '#E2BE66',
          'stroke-width': '1.3',
          'stroke-linecap': 'round',
        });
        const batTip = svgEl('circle', {
          class: 'toggle-tip',
          cx: meta.x,
          cy: meta.y - 2.55,
          r: '0.85',
          fill: '#F4F5F7',
        });

        const mandatoryTag = svgEl('g', { class: 'mandatory-badge', opacity: '0' });
        const bangText = svgEl('text', {
          x: meta.x + 2.5,
          y: meta.y - 1.85,
          'text-anchor': 'middle',
          'font-family': 'IBM Plex Sans, sans-serif',
          'font-size': '1.9',
          'font-weight': '800',
          fill: '#141518',
        });
        bangText.textContent = '!';
        mandatoryTag.append(
          svgEl('circle', {
            cx: meta.x + 2.5,
            cy: meta.y - 2.5,
            r: '1.25',
            fill: '#F87171',
            stroke: '#141518',
            'stroke-width': '0.25',
          }),
          bangText,
        );
        g.append(nut, bore, batShadow, bat, batTip, mandatoryTag);
      } else if (meta.kind === 'led') {
        const halo = svgEl('circle', {
          class: 'led-halo',
          cx: meta.x,
          cy: meta.y,
          r: '4.6',
          fill: 'url(#panel-led-glow)',
          opacity: '0',
        });
        const bezel = svgEl('circle', {
          cx: meta.x,
          cy: meta.y,
          r: '1.95',
          fill: '#101216',
          stroke: '#3E4352',
          'stroke-width': '0.22',
        });
        const dome = svgEl('circle', {
          class: 'led-dome',
          cx: meta.x,
          cy: meta.y,
          r: '1.55',
          fill: '#1B1E25',
          stroke: '#363B47',
          'stroke-width': '0.2',
        });
        const glint = svgEl('circle', {
          cx: meta.x - 0.45,
          cy: meta.y - 0.45,
          r: '0.42',
          fill: '#FFFFFF',
          opacity: '0.35',
        });
        g.append(halo, bezel, dome, glint);
      } else if (meta.kind === 'jack') {
        const collar = svgEl('circle', {
          class: 'jack-collar',
          cx: meta.x,
          cy: meta.y,
          r: '3.9',
          fill: 'none',
          stroke: 'transparent',
          'stroke-width': '0.7',
        });
        const nut = svgEl('circle', {
          class: 'jack-nut',
          cx: meta.x,
          cy: meta.y,
          r: '3.1',
          fill: 'url(#panel-jack-nut)',
          stroke: '#666D80',
          'stroke-width': '0.24',
        });
        const washer = svgEl('circle', {
          cx: meta.x,
          cy: meta.y,
          r: '2.35',
          fill: '#1E222B',
          stroke: '#4E5466',
          'stroke-width': '0.18',
        });
        const bore = svgEl('circle', {
          class: 'jack-bore',
          cx: meta.x,
          cy: meta.y,
          r: '1.55',
          fill: '#07080A',
        });
        const plug = svgEl('circle', {
          class: 'jack-plug',
          cx: meta.x,
          cy: meta.y,
          r: '1.65',
          fill: '#D8B154',
          stroke: '#141518',
          'stroke-width': '0.3',
          opacity: '0',
        });
        g.append(collar, nut, washer, bore, plug);
      }

      const emitHover = (controlId: PanelControlId | null) => {
        this.dispatchEvent(
          new CustomEvent<{ controlId: PanelControlId | null }>('panel-control-hover', {
            detail: { controlId },
            bubbles: true,
            composed: true,
          }),
        );
      };
      const emitSelect = (controlId: PanelControlId) => {
        this.dispatchEvent(
          new CustomEvent<{ controlId: PanelControlId }>('panel-control-select', {
            detail: { controlId },
            bubbles: true,
            composed: true,
          }),
        );
      };

      g.addEventListener('pointerenter', () => emitHover(id));
      g.addEventListener('pointerleave', () => emitHover(null));
      g.addEventListener('focus', () => emitHover(id));
      g.addEventListener('blur', () => emitHover(null));
      g.addEventListener('click', () => emitSelect(id));
      g.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          emitSelect(id);
        }
      });

      this.#controlGroups.set(id, g);
      controlsLayer.append(g);
    }

    svg.append(bgGroup, faceplateHost, normalBreak, controlsLayer);
    this.#root.append(style, svg);
  }

  #renderState(): void {
    if (!this.#svgBuilt) {
      return;
    }

    const p = this.#preset;
    const isSkewMode =
      this.#mode === 'asymmetric-skew-limiter' ||
      Boolean(p?.knobs.gain.bypassed) ||
      p?.jacks.slewIn.state === 'active';

    if (this.#normalArrowEl) {
      this.#normalArrowEl.setAttribute('opacity', isSkewMode ? '0.22' : '1');
    }
    if (this.#normalBreakEl) {
      this.#normalBreakEl.setAttribute('opacity', isSkewMode ? '1' : '0');
    }

    if (p) {
      const potEntries = [
        ['rv1', p.knobs.gain],
        ['rv2', p.knobs.atk],
        ['rv3', p.knobs.rel],
        ['rv4', p.knobs.offset],
      ] as const;

      for (const [id, data] of potEntries) {
        const g = this.#controlGroups.get(id);
        if (!g) continue;
        const meta = PANEL_CONTROL_COORDS[id];
        const deg = tickToDeg(data.tick);
        const bypassed = Boolean(data.bypassed || (id === 'rv1' && isSkewMode));

        const rotator = g.querySelector<SVGGElement>('.knob-rotator');
        const arc = g.querySelector<SVGPathElement>('.knob-range-arc');
        const bypass = g.querySelector<SVGGElement>('.bypass-overlay');
        const pointer = g.querySelector<SVGLineElement>('.knob-pointer');

        if (rotator) {
          rotator.style.transform = `rotate(${deg}deg)`;
        }
        if (arc) {
          if (!bypassed && data.range[1] > data.range[0]) {
            arc.setAttribute('d', describeSweepArc(meta.x, meta.y, 5.65, data.range[0], data.range[1]));
            arc.setAttribute('opacity', '0.9');
          } else {
            arc.setAttribute('d', '');
            arc.setAttribute('opacity', '0');
          }
        }
        if (bypass) {
          bypass.setAttribute('opacity', bypassed ? '1' : '0');
        }
        if (pointer) {
          pointer.setAttribute('stroke', bypassed ? '#585E6E' : '#F4F5F7');
        }
        g.classList.toggle('is-bypassed', bypassed);
        g.setAttribute('aria-label', `${meta.label}: ${data.positionLabel}. ${data.effect}`);
      }

      const switchEntries = [
        ['sw1', { ...p.switches.sw1, upValue: 'SMOOTH' }],
        ['sw2', { ...p.switches.sw2, upValue: 'SLOW' }],
      ] as const;

      for (const [id, data] of switchEntries) {
        const g = this.#controlGroups.get(id);
        if (!g) continue;
        const meta = PANEL_CONTROL_COORDS[id];
        const isUp = data.state === data.upValue;
        const tipY = isUp ? meta.y - 2.55 : meta.y + 2.55;

        const bat = g.querySelector('.toggle-bat');
        const shadow = g.querySelector('.toggle-bat-shadow');
        const tip = g.querySelector('.toggle-tip');
        const mandatory = g.querySelector('.mandatory-badge');

        if (bat) {
          bat.setAttribute('y2', String(tipY));
          bat.setAttribute('stroke', data.mandatory ? '#F87171' : '#E2BE66');
        }
        if (shadow) shadow.setAttribute('y2', String(tipY));
        if (tip) tip.setAttribute('cy', String(tipY));
        if (mandatory) mandatory.setAttribute('opacity', data.mandatory ? '1' : '0');

        g.classList.toggle('is-mandatory-alert', Boolean(data.mandatory));
        g.setAttribute('aria-label', `${meta.label} toggle: ${data.label}. ${data.effect}`);
      }

      const ledG = this.#controlGroups.get('led1');
      if (ledG) {
        const ledKey = this.#signalState === 'active' ? p.led.activeState : p.led.idleState;
        const visual = ledStyleForState(ledKey);
        const dome = ledG.querySelector('.led-dome');
        const halo = ledG.querySelector('.led-halo');
        const grad = this.#root.getElementById('panel-led-glow');

        if (dome) {
          dome.setAttribute('fill', visual.core);
          dome.setAttribute('stroke', visual.rim);
        }
        if (grad) {
          grad.querySelectorAll('stop').forEach((stop, idx) => {
            stop.setAttribute('stop-color', visual.core);
            if (idx === 0) {
              stop.setAttribute('stop-opacity', visual.glowOpacity !== '0' ? '0.95' : '0');
            } else if (idx === 1) {
              stop.setAttribute('stop-opacity', visual.glowOpacity !== '0' ? '0.42' : '0');
            }
          });
        }
        if (halo) {
          halo.setAttribute('opacity', visual.glowOpacity);
        }

        const desc = this.#signalState === 'active' ? p.led.activeDesc : p.led.idleDesc;
        ledG.setAttribute('aria-label', `+ / − LED (${this.#signalState}): ${visual.label}. ${desc}`);
      }

      const jackEntries = [
        ['j1', p.jacks.in],
        ['j2', p.jacks.slewIn],
        ['j3', p.jacks.out],
        ['j4', p.jacks.invOut],
      ] as const;

      for (const [id, data] of jackEntries) {
        const g = this.#controlGroups.get(id);
        if (!g) continue;
        const meta = PANEL_CONTROL_COORDS[id];
        const collar = g.querySelector('.jack-collar');
        const plug = g.querySelector('.jack-plug');
        const nut = g.querySelector('.jack-nut');

        if (collar && plug && nut) {
          if (data.state === 'active') {
            collar.setAttribute('stroke', '#E2BE66');
            collar.removeAttribute('stroke-dasharray');
            plug.setAttribute('opacity', '1');
            nut.setAttribute('opacity', '1');
          } else if (data.state === 'optional') {
            collar.setAttribute('stroke', '#D8B154');
            collar.setAttribute('stroke-dasharray', '1.2 0.85');
            plug.setAttribute('opacity', '0.25');
            nut.setAttribute('opacity', '0.95');
          } else if (data.state === 'bypassed') {
            collar.setAttribute('stroke', 'transparent');
            collar.removeAttribute('stroke-dasharray');
            plug.setAttribute('opacity', '0');
            nut.setAttribute('opacity', '0.35');
          } else {
            collar.setAttribute('stroke', 'transparent');
            collar.removeAttribute('stroke-dasharray');
            plug.setAttribute('opacity', '0');
            nut.setAttribute('opacity', '0.9');
          }
        }
        g.classList.toggle('is-bypassed', data.state === 'bypassed');
        g.setAttribute('aria-label', `${meta.label} jack (${data.state}): ${data.note}`);
      }
    }

    for (const [id, g] of this.#controlGroups.entries()) {
      const isHighlighted = this.#activeControl === id;
      const isLocked = this.#lockedControl === id;
      const isBypassed = g.classList.contains('is-bypassed');

      g.classList.toggle('is-highlighted', isHighlighted);
      g.classList.toggle('is-locked', isLocked);
      g.classList.toggle('is-dimmed', isBypassed && !isHighlighted && !isLocked);
      g.setAttribute('aria-pressed', String(isLocked));
    }
  }
}

if (!customElements.get('env-skew-panel')) {
  customElements.define('env-skew-panel', EnvSkewPanel);
}
