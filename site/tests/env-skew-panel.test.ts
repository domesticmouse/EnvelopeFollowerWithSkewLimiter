import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import '../src/components/env-skew-panel.ts';
import type { EnvSkewPanel } from '../src/components/env-skew-panel.ts';
import { getPatchStateBySlug } from '../src/data/patch-states.ts';
import { describeSweepArc, polarPoint, tickToDeg } from '../src/lib/panel-svg.ts';

function mountPanel(): { panel: EnvSkewPanel; cleanup: () => void } {
  const panel = document.createElement('env-skew-panel') as EnvSkewPanel;
  document.body.append(panel);
  return {
    panel,
    cleanup: () => {
      panel.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('<env-skew-panel> Native Web Component & dial math', () => {
  it('computes accurate 11-tick dial coordinates and sweep arcs at r=5.65mm', () => {
    expect(tickToDeg(0)).toBe(-150);
    expect(tickToDeg(5)).toBe(0);
    expect(tickToDeg(10)).toBe(150);

    const top = polarPoint(15, 21.25, 5.65, 0);
    expect(top.x).toBeCloseTo(15, 3);
    expect(top.y).toBeCloseTo(21.25 - 5.65, 3);

    const fullArc = describeSweepArc(15, 21.25, 5.65, 0, 10);
    expect(fullArc).toContain('A 5.65 5.65 0 1 1');

    const smallArc = describeSweepArc(15, 21.25, 5.65, 4, 6);
    expect(smallArc).toContain('A 5.65 5.65 0 0 1');

    expect(describeSweepArc(15, 21.25, 5.65, 5, 5)).toBe('');
  });

  it('uses open Shadow DOM without delegatesFocus and inlines real panel layers with zero runtime fetches', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { panel, cleanup } = mountPanel();
    try {
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(panel.shadowRoot).not.toBeNull();
      expect(panel.shadowRoot?.delegatesFocus).toBe(false);

      const svg = panel.shadowRoot?.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 30.00 128.50');
      expect(panel.shadowRoot?.querySelector('#_01_F_Mask_Gold')).not.toBeNull();
      expect(panel.shadowRoot?.querySelector('#_02_F_SilkS_White')).not.toBeNull();
      expect(panel.shadowRoot?.querySelector('#_03_Registration_Frame')).toBeNull();
      expect(panel.shadowRoot?.querySelector('[data-normal-arrow="true"]')).not.toBeNull();

      const interactiveControls = [...(panel.shadowRoot?.querySelectorAll<SVGGElement>('[data-control]') ?? [])];
      expect(interactiveControls).toHaveLength(11);
      for (const ctrl of interactiveControls) {
        expect(ctrl.getAttribute('role')).toBe('button');
        expect(ctrl.getAttribute('tabindex')).toBe('0');
        expect(ctrl.getAttribute('aria-pressed')).toBe('false');
      }
    } finally {
      cleanup();
    }
  });

  it('renders Asymmetric Skew Limiter Mode GAIN BYPASS, dimmed normaling arrow, red break slash, and mandatory ! ring', () => {
    const { panel, cleanup } = mountPanel();
    try {
      const patch06 = getPatchStateBySlug('06-audio-rate-slew-waveshaping');
      expect(patch06).toBeDefined();
      panel.setPreset(patch06!.presets[0]!, patch06!.mode);

      const shadow = panel.shadowRoot!;
      const rv1 = shadow.querySelector('[data-control="rv1"]');
      expect(rv1?.classList.contains('is-bypassed')).toBe(true);
      expect(rv1?.querySelector('.bypass-overlay')?.getAttribute('opacity')).toBe('1');

      const normalArrow = shadow.querySelector('[data-normal-arrow="true"]');
      expect(normalArrow?.getAttribute('opacity')).toBe('0.22');

      const breakSlash = shadow.querySelector('.normal-break-overlay');
      expect(breakSlash?.getAttribute('opacity')).toBe('1');

      const sw1 = shadow.querySelector('[data-control="sw1"]');
      expect(sw1?.classList.contains('is-mandatory-alert')).toBe(true);
      expect(sw1?.querySelector('.mandatory-badge')?.getAttribute('opacity')).toBe('1');

      // Envelope Follower mode restores normaling arrow and hides GAIN BYPASS
      const patch01 = getPatchStateBySlug('01-sidechain-ducking')!;
      panel.setPreset(patch01.presets[0]!, patch01.mode);
      expect(rv1?.classList.contains('is-bypassed')).toBe(false);
      expect(normalArrow?.getAttribute('opacity')).toBe('1');
      expect(breakSlash?.getAttribute('opacity')).toBe('0');
      expect(sw1?.classList.contains('is-mandatory-alert')).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('renders all 6 LED states and jack collar states accurately', () => {
    const { panel, cleanup } = mountPanel();
    try {
      const basePreset = structuredClone(getPatchStateBySlug('01-sidechain-ducking')!.presets[0]!);
      const shadow = panel.shadowRoot!;
      const dome = shadow.querySelector('[data-control="led1"] .led-dome')!;
      const halo = shadow.querySelector('[data-control="led1"] .led-halo')!;

      const cases = [
        { state: 'green', color: '#4ADE80', glow: '0.72' },
        { state: 'bright-green', color: '#4ADE80', glow: '0.9' },
        { state: 'red', color: '#F87171', glow: '0.78' },
        { state: 'dim-red', color: '#EF4444', glow: '0.42' },
        { state: 'dark', color: '#1B1E25', glow: '0' },
        { state: 'amber', color: '#FBBF24', glow: '0.8' },
      ] as const;

      for (const item of cases) {
        basePreset.led.activeState = item.state;
        panel.setSignalState('active');
        panel.setPreset(basePreset, 'envelope-follower');
        expect(dome.getAttribute('fill')).toBe(item.color);
        expect(halo.getAttribute('opacity')).toBe(item.glow);
      }

      // Jack collar states
      basePreset.jacks.in.state = 'active';
      basePreset.jacks.slewIn.state = 'optional';
      basePreset.jacks.out.state = 'idle';
      basePreset.jacks.invOut.state = 'bypassed';
      panel.setPreset(basePreset, 'envelope-follower');

      expect(shadow.querySelector('[data-control="j1"] .jack-collar')?.getAttribute('stroke')).toBe(
        '#E2BE66',
      );
      expect(
        shadow.querySelector('[data-control="j2"] .jack-collar')?.getAttribute('stroke-dasharray'),
      ).toBe('1.2 0.85');
      expect(shadow.querySelector('[data-control="j3"] .jack-collar')?.getAttribute('stroke')).toBe(
        'transparent',
      );
      expect(shadow.querySelector('[data-control="j4"] .jack-nut')?.getAttribute('opacity')).toBe(
        '0.35',
      );
    } finally {
      cleanup();
    }
  });

  it('dispatches composed bubbling panel-control-hover and panel-control-select events on keyboard/pointer activation', () => {
    const { panel, cleanup } = mountPanel();
    try {
      const patch01 = getPatchStateBySlug('01-sidechain-ducking')!;
      panel.setPreset(patch01.presets[0]!, patch01.mode);

      const hovered: Array<string | null> = [];
      const selected: Array<string | null> = [];

      document.body.addEventListener('panel-control-hover', (e) => {
        hovered.push((e as CustomEvent<{ controlId: string | null }>).detail.controlId);
      });
      document.body.addEventListener('panel-control-select', (e) => {
        selected.push((e as CustomEvent<{ controlId: string | null }>).detail.controlId);
      });

      const rv3 = panel.shadowRoot!.querySelector<SVGGElement>('[data-control="rv3"]')!;
      rv3.dispatchEvent(new Event('focus'));
      rv3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      rv3.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(hovered).toContain('rv3');
      expect(selected).toEqual(['rv3', 'rv3']);

      panel.setLockedControl('rv3');
      expect(rv3.getAttribute('aria-pressed')).toBe('true');

      // Keep unused Window import tree-shaken cleanly
      expect(typeof Window).toBe('function');
    } finally {
      cleanup();
    }
  });
});
