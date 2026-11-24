import { afterEach, describe, expect, it } from 'vitest';
import { initToggletips } from '../src/lib/toggletip.ts';

let cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  document.body.innerHTML = '';
});

describe('Accessible [popover="hint"] toggletip helper', () => {
  it('wires role="tooltip", syncs aria-expanded on toggle, and switches hint -> auto on beforetoggle when hint is unsupported', () => {
    document.body.innerHTML = `
      <button
        type="button"
        id="scale-btn"
        interestfor="dial-scale-tip"
        popovertarget="dial-scale-tip"
        popovertargetaction="show"
        aria-label="Explain 11-tick knob dial scale"
      >?</button>
      <div id="dial-scale-tip" popover="hint">All four knobs have 11 radial ticks spaced 30° apart.</div>
    `;

    cleanups.push(initToggletips(document, { supportsHintPopover: false, supportsInterestFor: false }));

    const btn = document.getElementById('scale-btn') as HTMLButtonElement;
    const tip = document.getElementById('dial-scale-tip') as HTMLElement;

    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // Simulate capturing beforetoggle on unsupported hint browsers (e.g. Safari)
    const beforeOpen = new Event('beforetoggle', { cancelable: false }) as Event & {
      newState: string;
    };
    Object.defineProperty(beforeOpen, 'newState', { value: 'open' });
    tip.dispatchEvent(beforeOpen);
    expect(tip.getAttribute('popover')).toBe('auto');

    // Sync aria-expanded from capturing toggle event
    const toggleOpen = new Event('toggle') as Event & { newState: string };
    Object.defineProperty(toggleOpen, 'newState', { value: 'open' });
    tip.dispatchEvent(toggleOpen);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    const toggleClosed = new Event('toggle') as Event & { newState: string };
    Object.defineProperty(toggleClosed, 'newState', { value: 'closed' });
    tip.dispatchEvent(toggleClosed);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves popover="hint" when native hint support exists', () => {
    document.body.innerHTML = `
      <button type="button" id="tip-btn" interestfor="tip" popovertarget="tip" popovertargetaction="show" aria-label="Scale info">?</button>
      <div id="tip" popover="hint">Dial scale explanation</div>
    `;

    cleanups.push(initToggletips(document, { supportsHintPopover: true, supportsInterestFor: true }));

    const tip = document.getElementById('tip') as HTMLElement;
    const beforeOpen = new Event('beforetoggle') as Event & { newState: string };
    Object.defineProperty(beforeOpen, 'newState', { value: 'open' });
    tip.dispatchEvent(beforeOpen);

    expect(tip.getAttribute('popover')).toBe('hint');
  });
});
