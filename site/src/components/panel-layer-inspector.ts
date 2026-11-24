import { getInlinedPanelKeepoutMarkup } from '../lib/panel-keepouts-inline.ts';
import { getInlinedFaceplateLayers } from '../lib/panel-layers-inline.ts';
import { PANEL_VIEWBOX } from '../lib/panel-svg-shared.ts';
import { withBase } from '../lib/routes.ts';
import { openFullscreenLightbox } from './zoom-pan-viewer.ts';

export class PanelLayerInspector extends HTMLElement {
  #initialized = false;

  connectedCallback(): void {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#render();
  }

  #render(): void {
    const slotOverlayEl = this.querySelector('[slot="layers-overlay-source"]');
    const keepoutMarkup = slotOverlayEl?.innerHTML.trim() || getInlinedPanelKeepoutMarkup();
    const { goldLayerSvg, silkLayerSvg, registrationFrameSvg } = getInlinedFaceplateLayers();

    const prefix = 'pli-' + Math.random().toString(36).slice(2, 7);

    this.innerHTML = `
      <div class="panel-inspector-shell">
        <div class="preset-tablist panel-inspector-tablist" role="tablist" aria-label="Front-panel inspection views">
          <button
            type="button"
            role="tab"
            id="${prefix}-tab-layers"
            class="preset-tab"
            aria-selected="true"
            tabindex="0"
            data-inspector-tab="0"
          >Interactive Layers</button>
          <button
            type="button"
            role="tab"
            id="${prefix}-tab-front"
            class="preset-tab"
            aria-selected="false"
            tabindex="-1"
            data-inspector-tab="1"
          >3D Front</button>
          <button
            type="button"
            role="tab"
            id="${prefix}-tab-back"
            class="preset-tab"
            aria-selected="false"
            tabindex="-1"
            data-inspector-tab="2"
          >3D Back (B.SilkS)</button>
        </div>

        <div
          role="tabpanel"
          id="${prefix}-panel-layers"
          aria-labelledby="${prefix}-tab-layers"
          tabindex="0"
          data-inspector-panel="0"
        >
          <div class="inspector-panel-inner">
            <div class="layer-toggle-grid" role="group" aria-label="Front-panel vector layer toggles">
              <label class="layer-toggle-label">
                <input type="checkbox" class="layer-checkbox" data-layer-toggle="fmask" checked />
                <span><code>F.Mask</code> ENIG Gold</span>
              </label>
              <label class="layer-toggle-label">
                <input type="checkbox" class="layer-checkbox" data-layer-toggle="fsilks" checked />
                <span><code>F.SilkS</code> White</span>
              </label>
              <label class="layer-toggle-label">
                <input type="checkbox" class="layer-checkbox" data-layer-toggle="keepouts" />
                <span>Mechanical Keepouts</span>
              </label>
              <label class="layer-toggle-label">
                <input type="checkbox" class="layer-checkbox" data-layer-toggle="regframe" />
                <span>Registration Frame</span>
              </label>
            </div>

            <div class="keepout-legend" data-keepout-legend hidden>
              <span class="legend-item" data-swatch="knob"><i class="swatch swatch-knob" aria-hidden="true"></i> Max Knob Ø 14.0 mm</span>
              <span class="legend-item" data-swatch="keepout"><i class="swatch swatch-keepout" aria-hidden="true"></i> Mechanical Keepout</span>
              <span class="legend-item" data-swatch="drill"><i class="swatch swatch-drill" aria-hidden="true"></i> PTH / NPTH Drill</span>
              <span class="legend-item" data-swatch="rail"><i class="swatch swatch-rail" aria-hidden="true"></i> Rail Keepout (6.5 mm)</span>
            </div>

            <div class="panel-vector-stage">
              <svg
                class="panel-inspector-svg"
                viewBox="${PANEL_VIEWBOX}"
                width="160"
                height="685"
                role="img"
                aria-label="ENV / SKEW 6 HP interactive SVG layers"
              >
                <rect x="0.15" y="0.15" width="29.7" height="128.2" rx="0.4" fill="#141518" stroke="#6E7485" stroke-width="0.3" />
                <rect x="4.75" y="1.4" width="5.5" height="3.2" rx="1.6" fill="#090A0D" stroke="#464C5C" stroke-width="0.2" />
                <rect x="4.75" y="123.9" width="5.5" height="3.2" rx="1.6" fill="#090A0D" stroke="#464C5C" stroke-width="0.2" />
                <g data-layer="fmask">${goldLayerSvg}</g>
                <g data-layer="fsilks">${silkLayerSvg}</g>
                <g data-layer="keepouts" display="none" hidden>${keepoutMarkup}</g>
                <g data-layer="regframe" display="none" hidden>${registrationFrameSvg}</g>
              </svg>

              <div class="panel-keepout-preview-card">
                <button
                  type="button"
                  class="pcb-plate-btn"
                  data-panel-lightbox="keepouts"
                  aria-label="Inspect rendered mechanical keepouts preview in fullscreen"
                >
                  <img
                    src="${withBase('/panel_art/preview_keepouts.png')}"
                    alt="ENV / SKEW front panel mechanical keepouts preview"
                    width="709"
                    height="3035"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
                <p class="panel-preview-caption mono">Rendered Keepouts Audit (<code>preview_keepouts.png</code>)</p>
              </div>
            </div>
          </div>
        </div>

        <div
          role="tabpanel"
          id="${prefix}-panel-front"
          aria-labelledby="${prefix}-tab-front"
          hidden="until-found"
          data-inspector-panel="1"
        >
          <div class="inspector-panel-inner">
            <button
              type="button"
              class="pcb-plate-btn panel-3d-btn"
              data-panel-lightbox="front"
              aria-label="Inspect 3D Front panel render in fullscreen"
            >
              <img
                src="${withBase('/images/panel_front.png')}"
                alt="ENV / SKEW 6 HP front panel 3D render (Matte Black + ENIG Gold + White)"
                width="872"
                height="2384"
                loading="lazy"
                decoding="async"
              />
            </button>
          </div>
        </div>

        <div
          role="tabpanel"
          id="${prefix}-panel-back"
          aria-labelledby="${prefix}-tab-back"
          hidden="until-found"
          data-inspector-panel="2"
        >
          <div class="inspector-panel-inner">
            <button
              type="button"
              class="pcb-plate-btn panel-3d-btn"
              data-panel-lightbox="back"
              aria-label="Inspect 3D Back B.SilkS panel render in fullscreen"
            >
              <img
                src="${withBase('/images/panel_back.png')}"
                alt="ENV / SKEW 6 HP back panel 3D render (grounded rings, B.SilkS metadata, QR blank)"
                width="872"
                height="2384"
                loading="lazy"
                decoding="async"
              />
            </button>
          </div>
        </div>
      </div>
    `;

    this.#bindEvents();
  }

  #bindEvents(): void {
    const tabs = [...this.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]')];
    const panels = [...this.querySelectorAll<HTMLElement>('[data-inspector-panel]')];

    const selectTab = (idx: number, focusTab = false): void => {
      for (const tab of tabs) {
        const isMatch = Number(tab.getAttribute('data-inspector-tab')) === idx;
        tab.setAttribute('aria-selected', String(isMatch));
        tab.setAttribute('tabindex', isMatch ? '0' : '-1');
        if (isMatch && focusTab) {
          tab.focus();
        }
      }
      for (const panel of panels) {
        const isMatch = Number(panel.getAttribute('data-inspector-panel')) === idx;
        if (isMatch) {
          panel.removeAttribute('hidden');
          panel.setAttribute('tabindex', '0');
        } else {
          panel.setAttribute('hidden', 'until-found');
          panel.removeAttribute('tabindex');
        }
      }
    };

    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const idx = Number(tab.getAttribute('data-inspector-tab'));
        selectTab(idx);
      });
      tab.addEventListener('keydown', (event) => {
        const current = tabs.indexOf(tab);
        let next = -1;
        if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next !== -1) {
          event.preventDefault();
          selectTab(next, true);
        }
      });
    }

    for (const panel of panels) {
      panel.addEventListener('beforematch', () => {
        const idx = Number(panel.getAttribute('data-inspector-panel'));
        if (!Number.isNaN(idx)) {
          selectTab(idx);
        }
      });
    }

    // 4 independent native layer toggles
    const layerCheckboxes = [...this.querySelectorAll<HTMLInputElement>('[data-layer-toggle]')];
    const legendEl = this.querySelector<HTMLElement>('[data-keepout-legend]');
    for (const cb of layerCheckboxes) {
      cb.addEventListener('change', () => {
        const layerKey = cb.getAttribute('data-layer-toggle');
        if (!layerKey) return;
        const targetGroup = this.querySelector<SVGGElement>(`[data-layer="${layerKey}"]`);
        if (targetGroup) {
          if (cb.checked) {
            targetGroup.removeAttribute('hidden');
            targetGroup.removeAttribute('display');
          } else {
            targetGroup.setAttribute('hidden', '');
            targetGroup.setAttribute('display', 'none');
          }
        }
        if (layerKey === 'keepouts' && legendEl) {
          legendEl.hidden = !cb.checked;
        }
      });
    }

    // Fullscreen lightbox items
    const lightboxMap: Record<
      string,
      { src: string; alt: string; width: number; height: number; caption: string }
    > = {
      front: {
        src: withBase('/images/panel_front.png'),
        alt: 'ENV / SKEW 6 HP Front Panel 3D Render (Matte Black + ENIG)',
        width: 872,
        height: 2384,
        caption: 'Front Panel — 3D Front (Matte Black + ENIG Gold)',
      },
      back: {
        src: withBase('/images/panel_back.png'),
        alt: 'ENV / SKEW 6 HP Front Panel Back 3D Render (B.SilkS)',
        width: 872,
        height: 2384,
        caption: 'Front Panel — 3D Back (Ground Rings, B.SilkS, QR Blank)',
      },
      keepouts: {
        src: withBase('/panel_art/preview_keepouts.png'),
        alt: 'ENV / SKEW Front Panel Mechanical Keepouts Audit',
        width: 709,
        height: 3035,
        caption: 'Front Panel — Mechanical Keepouts Audit',
      },
    };

    for (const btn of this.querySelectorAll<HTMLButtonElement>('[data-panel-lightbox]')) {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-panel-lightbox') ?? 'front';
        const item = lightboxMap[key] ?? lightboxMap.front!;
        openFullscreenLightbox({
          items: [item],
          startIndex: 0,
        });
      });
    }
  }
}

if (!customElements.get('panel-layer-inspector')) {
  customElements.define('panel-layer-inspector', PanelLayerInspector);
}
