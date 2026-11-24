import { afterEach, describe, expect, it } from 'vitest';
import '../src/components/env-skew-panel.ts';
import type { EnvSkewPanel } from '../src/components/env-skew-panel.ts';
import { PATCH_STATES } from '../src/data/patch-states.ts';
import { initPatchesHub } from '../src/lib/patches-hub-controller.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function buildHubDom(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div role="group" aria-label="Filter patches by mode">
      <button type="button" data-mode-filter="all" aria-pressed="true">All Modes (8)</button>
      <button type="button" data-mode-filter="envelope-follower" aria-pressed="false">Envelope Follower Mode (5)</button>
      <button type="button" data-mode-filter="asymmetric-skew-limiter" aria-pressed="false">Asymmetric Skew Limiter Mode (3)</button>
    </div>
    <ul data-patch-list>
      ${PATCH_STATES.map(
        (entry) => `
        <li data-patch-row="${entry.slug}" data-patch-mode="${entry.mode}">
          <a href="/EnvelopeFollowerWithSkewLimiter/patches/${entry.slug}/" data-patch-link="${entry.slug}">${entry.slug}</a>
          <button type="button" data-pin-patch="${entry.slug}" aria-pressed="false">Pin preview</button>
        </li>`,
      ).join('')}
    </ul>
    <aside data-hub-preview>
      <p data-preview-title></p>
      <p data-preview-preset></p>
      <span data-preview-led-pill></span>
      <button type="button" data-signal-btn="idle" aria-pressed="true">Idle</button>
      <button type="button" data-signal-btn="active" aria-pressed="false">Active Signal</button>
      <env-skew-panel></env-skew-panel>
      <a data-preview-open-link href="/EnvelopeFollowerWithSkewLimiter/patches/01-sidechain-ducking/">Open Guide</a>
    </aside>
  `;
  document.body.append(root);
  return root;
}

describe('patches-hub-controller', () => {
  it('filters patch rows by mode (8 / 5 / 3) and updates aria-pressed', () => {
    const root = buildHubDom();
    initPatchesHub(root, PATCH_STATES);

    const rows = () => [...root.querySelectorAll<HTMLElement>('[data-patch-row]')];
    const visibleCount = () => rows().filter((r) => !r.hidden).length;
    expect(visibleCount()).toBe(8);

    const efBtn = root.querySelector<HTMLButtonElement>('[data-mode-filter="envelope-follower"]')!;
    efBtn.click();
    expect(efBtn.getAttribute('aria-pressed')).toBe('true');
    expect(visibleCount()).toBe(5);

    const skewBtn = root.querySelector<HTMLButtonElement>(
      '[data-mode-filter="asymmetric-skew-limiter"]',
    )!;
    skewBtn.click();
    expect(skewBtn.getAttribute('aria-pressed')).toBe('true');
    expect(efBtn.getAttribute('aria-pressed')).toBe('false');
    expect(visibleCount()).toBe(3);

    const allBtn = root.querySelector<HTMLButtonElement>('[data-mode-filter="all"]')!;
    allBtn.click();
    expect(visibleCount()).toBe(8);
  });

  it('updates sticky <env-skew-panel> on hover/focus/pin and toggles Idle / Active Signal LED pills', () => {
    const root = buildHubDom();
    initPatchesHub(root, PATCH_STATES);

    const panel = root.querySelector('env-skew-panel') as EnvSkewPanel;
    const pill = root.querySelector('[data-preview-led-pill]')!;

    // Default initial patch 01 idle state: RED (-V)
    expect(panel.preset?.id).toBe('sidechain-main');
    expect(pill.textContent).toContain('RED');

    // Switch signal to active -> Patch 01 active LED is DARK (0 V)
    const activeBtn = root.querySelector<HTMLButtonElement>('[data-signal-btn="active"]')!;
    activeBtn.click();
    expect(panel.signalState).toBe('active');
    expect(pill.textContent).toContain('DARK');

    // Hover/focus Patch 06 -> BYPASS & amber LED
    const row06 = root.querySelector<HTMLElement>('[data-patch-row="06-audio-rate-slew-waveshaping"]')!;
    row06.dispatchEvent(new Event('pointerenter'));
    expect(panel.preset?.id).toBe('audio-slew-main');
    expect(pill.textContent).toContain('AMBER');
    expect(panel.shadowRoot?.querySelector('[data-control="rv1"]')?.classList.contains('is-bypassed')).toBe(true);

    // Pin Patch 06 and hover Patch 02 -> pinned Patch 06 remains active when pointer leaves
    const pin06 = root.querySelector<HTMLButtonElement>('[data-pin-patch="06-audio-rate-slew-waveshaping"]')!;
    pin06.click();
    expect(pin06.getAttribute('aria-pressed')).toBe('true');

    const row02 = root.querySelector<HTMLElement>('[data-patch-row="02-auto-wah-envelope-filter"]')!;
    row02.dispatchEvent(new Event('pointerenter'));
    expect(panel.preset?.id).toBe('autowah-upward');
    row02.dispatchEvent(new Event('pointerleave'));
    expect(panel.preset?.id).toBe('audio-slew-main');
  });
});
