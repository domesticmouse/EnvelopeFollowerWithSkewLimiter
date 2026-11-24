import type { EnvSkewPanel } from '../components/env-skew-panel.ts';
import {
  PATCH_CONTROL_METADATA,
  ledBadgeInfo,
  type PatchPreset,
  type PatchStateEntry,
} from '../data/patch-states.ts';
import type { PanelControlId } from './panel-svg-shared.ts';

interface ControlReadout {
  title: string;
  position: string;
  effect: string;
}

function describeControlForPreset(
  controlId: PanelControlId,
  preset: PatchPreset,
  signalState: 'idle' | 'active',
): ControlReadout {
  const meta = PATCH_CONTROL_METADATA.find((c) => c.id === controlId);
  const baseTitle = meta ? `${meta.ref} · ${meta.label}` : controlId.toUpperCase();

  switch (controlId) {
    case 'rv1':
      return {
        title: baseTitle,
        position: preset.knobs.gain.positionLabel,
        effect: preset.knobs.gain.effect,
      };
    case 'rv2':
      return {
        title: baseTitle,
        position: preset.knobs.atk.positionLabel,
        effect: preset.knobs.atk.effect,
      };
    case 'rv3':
      return {
        title: baseTitle,
        position: preset.knobs.rel.positionLabel,
        effect: preset.knobs.rel.effect,
      };
    case 'rv4':
      return {
        title: baseTitle,
        position: preset.knobs.offset.positionLabel,
        effect: preset.knobs.offset.effect,
      };
    case 'sw1':
      return {
        title: baseTitle,
        position: preset.switches.sw1.label,
        effect: preset.switches.sw1.effect,
      };
    case 'sw2':
      return {
        title: baseTitle,
        position: preset.switches.sw2.label,
        effect: preset.switches.sw2.effect,
      };
    case 'led1': {
      const ledKey = signalState === 'active' ? preset.led.activeState : preset.led.idleState;
      const badge = ledBadgeInfo(ledKey);
      return {
        title: baseTitle,
        position: `${badge.symbol} ${badge.text}`,
        effect: signalState === 'active' ? preset.led.activeDesc : preset.led.idleDesc,
      };
    }
    case 'j1':
      return {
        title: baseTitle,
        position: `Jack state: ${preset.jacks.in.state}`,
        effect: preset.jacks.in.note,
      };
    case 'j2':
      return {
        title: baseTitle,
        position: `Jack state: ${preset.jacks.slewIn.state}`,
        effect: preset.jacks.slewIn.note,
      };
    case 'j3':
      return {
        title: baseTitle,
        position: `Jack state: ${preset.jacks.out.state}`,
        effect: preset.jacks.out.note,
      };
    case 'j4':
      return {
        title: baseTitle,
        position: `Jack state: ${preset.jacks.invOut.state}`,
        effect: preset.jacks.invOut.note,
      };
  }
}

/**
 * Initialize the 3-column Studio Rack Workbench on /patches/01..08:
 * - WAI-ARIA A/B tablist (ArrowLeft/Right/Home/End + hidden="until-found" beforematch)
 * - Bi-directional sync between <env-skew-panel> controls and tr[data-control] table rows
 * - Synced Idle / Active Signal LED toggle & Control Inspector across desktop/mobile docks
 */
export function initPatchWorkbench(root: ParentNode, entry: PatchStateEntry): void {
  const panels = [...root.querySelectorAll<EnvSkewPanel>('env-skew-panel')];
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"][data-preset-tab]')];
  const tabPanels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"][data-preset-panel]')];
  const signalBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-signal-btn]')];
  const ledPills = [...root.querySelectorAll<HTMLElement>('[data-led-pill]')];
  const ledDescs = [...root.querySelectorAll<HTMLElement>('[data-led-desc]')];
  const mobilePresetNames = [...root.querySelectorAll<HTMLElement>('[data-mobile-preset-name]')];
  const controlRows = [...root.querySelectorAll<HTMLTableRowElement>('tr[data-control]')];
  const inspectorTitles = [...root.querySelectorAll<HTMLElement>('[data-inspector-title]')];
  const inspectorPositions = [...root.querySelectorAll<HTMLElement>('[data-inspector-pos]')];
  const inspectorEffects = [...root.querySelectorAll<HTMLElement>('[data-inspector-effect]')];

  let activePresetIdx = 0;
  let signalState: 'idle' | 'active' = 'idle';
  let hoveredControl: PanelControlId | null = null;
  let lockedControl: PanelControlId | null = null;

  const currentPreset = (): PatchPreset => entry.presets[activePresetIdx] ?? entry.presets[0]!;

  const syncControlReadout = (): void => {
    const preset = currentPreset();
    const targetControl = hoveredControl ?? lockedControl;

    if (!targetControl) {
      for (const el of inspectorTitles) {
        el.textContent = 'Select or hover any panel control';
      }
      for (const el of inspectorPositions) {
        el.textContent = preset.name;
      }
      for (const el of inspectorEffects) {
        el.textContent = preset.summary;
      }
    } else {
      const info = describeControlForPreset(targetControl, preset, signalState);
      for (const el of inspectorTitles) {
        el.textContent = info.title;
      }
      for (const el of inspectorPositions) {
        el.textContent = info.position;
      }
      for (const el of inspectorEffects) {
        el.textContent = info.effect;
      }
    }

    for (const panel of panels) {
      panel.setActiveControl(hoveredControl);
      panel.setLockedControl(lockedControl);
    }

    for (const row of controlRows) {
      const rowCtrl = row.getAttribute('data-control') as PanelControlId | null;
      row.classList.toggle('is-control-hovered', Boolean(rowCtrl && rowCtrl === hoveredControl));
      row.classList.toggle('is-control-locked', Boolean(rowCtrl && rowCtrl === lockedControl));
      row.setAttribute('aria-selected', String(Boolean(rowCtrl && rowCtrl === lockedControl)));
    }
  };

  const syncPresetAndSignal = (): void => {
    const preset = currentPreset();
    for (const panel of panels) {
      panel.setSignalState(signalState);
      panel.setPreset(preset, entry.mode);
    }

    const activeLedKey = signalState === 'active' ? preset.led.activeState : preset.led.idleState;
    const badge = ledBadgeInfo(activeLedKey);
    for (const pill of ledPills) {
      pill.setAttribute('data-led', badge.pillColor);
      pill.textContent = `${badge.symbol} ${badge.text}`;
    }
    for (const desc of ledDescs) {
      desc.textContent = signalState === 'active' ? preset.led.activeDesc : preset.led.idleDesc;
    }
    for (const nameEl of mobilePresetNames) {
      nameEl.textContent = preset.name;
    }

    for (const btn of signalBtns) {
      const btnMode = btn.getAttribute('data-signal-btn') === 'active' ? 'active' : 'idle';
      btn.setAttribute('aria-pressed', String(btnMode === signalState));
    }

    syncControlReadout();
  };

  const selectPreset = (nextIdx: number, moveFocus = false): void => {
    if (nextIdx < 0 || nextIdx >= entry.presets.length) return;
    activePresetIdx = nextIdx;

    for (const tab of tabs) {
      const tabIdx = Number(tab.getAttribute('data-preset-tab'));
      const isSelected = tabIdx === activePresetIdx;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.setAttribute('tabindex', isSelected ? '0' : '-1');
      if (isSelected && moveFocus) {
        tab.focus();
      }
    }

    for (const tabPanel of tabPanels) {
      const panelIdx = Number(tabPanel.getAttribute('data-preset-panel'));
      const isSelected = panelIdx === activePresetIdx;
      if (isSelected) {
        tabPanel.removeAttribute('hidden');
        tabPanel.setAttribute('tabindex', '0');
      } else {
        tabPanel.setAttribute('hidden', 'until-found');
        tabPanel.removeAttribute('tabindex');
      }
    }

    syncPresetAndSignal();
  };

  // Group tabs per tablist so desktop and mobile dock tabs stay synchronized
  for (const tab of tabs) {
    const tablist = tab.closest('[role="tablist"]');
    const localTabs = tablist
      ? [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"][data-preset-tab]')]
      : tabs;

    tab.addEventListener('click', () => {
      const idx = Number(tab.getAttribute('data-preset-tab'));
      selectPreset(idx);
    });

    tab.addEventListener('keydown', (event) => {
      const currentLocalIdx = localTabs.indexOf(tab);
      if (currentLocalIdx === -1) return;

      let targetLocalIdx: number | null = null;
      if (event.key === 'ArrowRight') {
        targetLocalIdx = (currentLocalIdx + 1) % localTabs.length;
      } else if (event.key === 'ArrowLeft') {
        targetLocalIdx = (currentLocalIdx - 1 + localTabs.length) % localTabs.length;
      } else if (event.key === 'Home') {
        targetLocalIdx = 0;
      } else if (event.key === 'End') {
        targetLocalIdx = localTabs.length - 1;
      }

      if (targetLocalIdx !== null) {
        event.preventDefault();
        const targetBtn = localTabs[targetLocalIdx];
        if (!targetBtn) return;
        const presetIdx = Number(targetBtn.getAttribute('data-preset-tab'));
        selectPreset(presetIdx, false);
        targetBtn.focus();
      }
    });
  }

  for (const tabPanel of tabPanels) {
    tabPanel.addEventListener('beforematch', () => {
      const idx = Number(tabPanel.getAttribute('data-preset-panel'));
      if (!Number.isNaN(idx)) {
        selectPreset(idx);
      }
    });
  }

  for (const btn of signalBtns) {
    btn.addEventListener('click', () => {
      signalState = btn.getAttribute('data-signal-btn') === 'active' ? 'active' : 'idle';
      syncPresetAndSignal();
    });
  }

  // Panel -> table row / Control Inspector events (composed bubbling from Shadow DOM)
  root.addEventListener('panel-control-hover', (event) => {
    const detail = (event as CustomEvent<{ controlId: PanelControlId | null }>).detail;
    hoveredControl = detail?.controlId ?? null;
    syncControlReadout();
  });

  root.addEventListener('panel-control-select', (event) => {
    const detail = (event as CustomEvent<{ controlId: PanelControlId | null }>).detail;
    const clicked = detail?.controlId ?? null;
    hoveredControl = null;
    lockedControl = lockedControl === clicked ? null : clicked;
    syncControlReadout();
  });

  // Table row -> panel / Control Inspector events
  for (const row of controlRows) {
    const ctrlId = row.getAttribute('data-control') as PanelControlId | null;
    if (!ctrlId) continue;

    row.addEventListener('pointerenter', () => {
      hoveredControl = ctrlId;
      syncControlReadout();
    });
    row.addEventListener('pointerleave', () => {
      if (hoveredControl === ctrlId) {
        hoveredControl = null;
        syncControlReadout();
      }
    });
    row.addEventListener('focus', () => {
      hoveredControl = ctrlId;
      syncControlReadout();
    });
    row.addEventListener('blur', () => {
      if (hoveredControl === ctrlId) {
        hoveredControl = null;
        syncControlReadout();
      }
    });
    row.addEventListener('click', () => {
      hoveredControl = null;
      lockedControl = lockedControl === ctrlId ? null : ctrlId;
      syncControlReadout();
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        hoveredControl = null;
        lockedControl = lockedControl === ctrlId ? null : ctrlId;
        syncControlReadout();
      } else if (event.key === 'Escape' && lockedControl) {
        hoveredControl = null;
        lockedControl = null;
        syncControlReadout();
      }
    });
  }

  // Initial state render
  selectPreset(0);
}
