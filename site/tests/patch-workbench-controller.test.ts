import { afterEach, describe, expect, it } from 'vitest';
import '../src/components/env-skew-panel.ts';
import type { EnvSkewPanel } from '../src/components/env-skew-panel.ts';
import { getPatchStateBySlug } from '../src/data/patch-states.ts';
import { initPatchWorkbench } from '../src/lib/patch-workbench-controller.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

function buildWorkbenchDom(slug: string): { root: HTMLElement; entry: NonNullable<ReturnType<typeof getPatchStateBySlug>> } {
  const entry = getPatchStateBySlug(slug)!;
  const root = document.createElement('div');

  const tabsHtml =
    entry.presets.length > 1
      ? `
    <div role="tablist" aria-label="Patch configurations">
      ${entry.presets
        .map(
          (preset, idx) => `
        <button
          type="button"
          role="tab"
          id="tab-${preset.id}"
          aria-selected="${idx === 0 ? 'true' : 'false'}"
          tabindex="${idx === 0 ? '0' : '-1'}"
          data-preset-tab="${idx}"
        >${idx === 0 ? 'A' : 'B'}</button>`,
        )
        .join('')}
    </div>
    ${entry.presets
      .map(
        (preset, idx) => `
      <div
        role="tabpanel"
        id="tabpanel-${preset.id}"
        aria-labelledby="tab-${preset.id}"
        ${idx === 0 ? 'tabindex="0"' : 'hidden="until-found"'}
        data-preset-panel="${idx}"
      >
        <div class="preset-panel-inner">
          <p>${preset.name}</p>
          <p>${preset.summary}</p>
        </div>
      </div>`,
      )
      .join('')}`
      : '';

  root.innerHTML = `
    <details class="mobile-panel-dock">
      <summary>
        <span data-mobile-preset-name>${entry.presets[0]!.name}</span>
        <span data-led-pill></span>
      </summary>
      <div class="mobile-panel-body">
        <button type="button" data-signal-btn="idle" aria-pressed="true">Idle</button>
        <button type="button" data-signal-btn="active" aria-pressed="false">Active Signal</button>
        <env-skew-panel data-panel-instance="mobile"></env-skew-panel>
      </div>
    </details>

    <article class="doc-prose">
      <h2>Front-Panel Starting Settings</h2>
      <table>
        <tbody>
          <tr data-control="rv1" tabindex="0"><th>GAIN</th><td>0</td><td>Drive</td></tr>
          <tr data-control="rv2" tabindex="0"><th>ATK</th><td>0</td><td>Attack</td></tr>
          <tr data-control="sw1" tabindex="0"><th>Left Toggle</th><td>UP</td><td>SMOOTH</td></tr>
          <tr data-control="led1" tabindex="0"><th>+ / - LED</th><td>Red</td><td>Zero</td></tr>
        </tbody>
      </table>
    </article>

    <aside class="patch-dock-aside">
      ${tabsHtml}
      <button type="button" data-signal-btn="idle" aria-pressed="true">Idle</button>
      <button type="button" data-signal-btn="active" aria-pressed="false">Active Signal</button>
      <span data-led-pill></span>
      <env-skew-panel data-panel-instance="desktop"></env-skew-panel>
      <div data-control-inspector>
        <p data-inspector-title></p>
        <p data-inspector-pos></p>
        <p data-inspector-effect></p>
      </div>
    </aside>
  `;

  document.body.append(root);
  return { root, entry };
}

describe('patch-workbench-controller', () => {
  it('implements WAI-ARIA A/B tablist keyboard navigation, beforematch sync, and updates both panel instances', () => {
    const { root, entry } = buildWorkbenchDom('03-compression-expansion-gating');
    initPatchWorkbench(root, entry);

    const desktopPanel = root.querySelector<EnvSkewPanel>('[data-panel-instance="desktop"]')!;
    const mobilePanel = root.querySelector<EnvSkewPanel>('[data-panel-instance="mobile"]')!;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

    expect(desktopPanel.preset?.id).toBe('comp-opto');
    expect(mobilePanel.preset?.id).toBe('comp-opto');

    // ArrowRight moves selection to Tab B
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0');
    expect(tabs[0]!.getAttribute('tabindex')).toBe('-1');
    expect(panels[1]!.hasAttribute('hidden')).toBe(false);
    expect(panels[0]!.getAttribute('hidden')).toBe('until-found');
    expect(desktopPanel.preset?.id).toBe('gate-threshold');
    expect(mobilePanel.preset?.id).toBe('gate-threshold');

    // Find-in-page beforematch on hidden Panel A switches back to Tab A
    panels[0]!.dispatchEvent(new Event('beforematch', { bubbles: true }));
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(desktopPanel.preset?.id).toBe('comp-opto');
  });

  it('synchronizes data-control rows, <env-skew-panel>, and Control Inspector bi-directionally', () => {
    const { root, entry } = buildWorkbenchDom('01-sidechain-ducking');
    initPatchWorkbench(root, entry);

    const desktopPanel = root.querySelector<EnvSkewPanel>('[data-panel-instance="desktop"]')!;
    const rv2Row = root.querySelector<HTMLTableRowElement>('tr[data-control="rv2"]')!;
    const sw1Row = root.querySelector<HTMLTableRowElement>('tr[data-control="sw1"]')!;
    const inspectorTitle = root.querySelector('[data-inspector-title]')!;
    const inspectorPos = root.querySelector('[data-inspector-pos]')!;

    // Panel -> table row hover & select
    const shadowRv2 = desktopPanel.shadowRoot!.querySelector<SVGGElement>('[data-control="rv2"]')!;
    shadowRv2.dispatchEvent(new Event('focus'));
    expect(rv2Row.classList.contains('is-control-hovered')).toBe(true);
    expect(inspectorTitle.textContent).toContain('ATK');

    shadowRv2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(rv2Row.classList.contains('is-control-locked')).toBe(true);
    expect(shadowRv2.getAttribute('aria-pressed')).toBe('true');

    // Table row -> panel click lock switches lock to sw1
    sw1Row.click();
    expect(sw1Row.classList.contains('is-control-locked')).toBe(true);
    expect(rv2Row.classList.contains('is-control-locked')).toBe(false);
    expect(inspectorTitle.textContent).toContain('SMOOTH');
    expect(inspectorPos.textContent).toContain('SMOOTH');
    expect(
      desktopPanel.shadowRoot!.querySelector('[data-control="sw1"]')?.getAttribute('aria-pressed'),
    ).toBe('true');

    // Clicking locked row again unlocks
    sw1Row.click();
    expect(sw1Row.classList.contains('is-control-locked')).toBe(false);
    expect(
      desktopPanel.shadowRoot!.querySelector('[data-control="sw1"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('syncs Idle / Active Signal LED toggle across desktop dock and mobile status summary', () => {
    const { root, entry } = buildWorkbenchDom('01-sidechain-ducking');
    initPatchWorkbench(root, entry);

    const desktopPanel = root.querySelector<EnvSkewPanel>('[data-panel-instance="desktop"]')!;
    const mobilePanel = root.querySelector<EnvSkewPanel>('[data-panel-instance="mobile"]')!;
    const pills = [...root.querySelectorAll('[data-led-pill]')];

    expect(pills.every((p) => p.textContent?.includes('RED'))).toBe(true);

    const activeBtns = root.querySelectorAll<HTMLButtonElement>('[data-signal-btn="active"]');
    activeBtns[0]!.click();

    expect(desktopPanel.signalState).toBe('active');
    expect(mobilePanel.signalState).toBe('active');
    expect(pills.every((p) => p.textContent?.includes('DARK'))).toBe(true);
  });
});
