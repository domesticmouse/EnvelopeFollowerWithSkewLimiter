import type { EnvSkewPanel } from '../components/env-skew-panel.ts';
import { ledBadgeInfo, type PatchMode, type PatchStateEntry } from '../data/patch-states.ts';
import { withBase } from './routes.ts';

type ModeFilter = 'all' | PatchMode;

/**
 * Wire interactive mode filtering, hover/focus/pin <env-skew-panel> preview,
 * and Idle / Active Signal LED toggle on the /patches/ Studio Rack Hub.
 */
export function initPatchesHub(
  root: ParentNode,
  entries: readonly PatchStateEntry[],
): void {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const panel = root.querySelector<EnvSkewPanel>('env-skew-panel');
  const rows = [...root.querySelectorAll<HTMLElement>('[data-patch-row]')];
  const filterBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-mode-filter]')];
  const pinBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-pin-patch]')];
  const signalBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-signal-btn]')];

  const titleEl = root.querySelector<HTMLElement>('[data-preview-title]');
  const presetEl = root.querySelector<HTMLElement>('[data-preview-preset]');
  const ledPillEl = root.querySelector<HTMLElement>('[data-preview-led-pill]');
  const ledDescEl = root.querySelector<HTMLElement>('[data-preview-led-desc]');
  const openLinkEl = root.querySelector<HTMLAnchorElement>('[data-preview-open-link]');

  let pinnedSlug: string = entries[0]?.slug ?? '';
  let previewedSlug: string = pinnedSlug;
  let signalState: 'idle' | 'active' = 'idle';

  const renderPreview = (slug: string): void => {
    const entry = bySlug.get(slug) ?? entries[0];
    if (!entry) return;
    const preset = entry.presets[0];
    if (!preset) return;

    previewedSlug = entry.slug;
    if (panel) {
      panel.setSignalState(signalState);
      panel.setPreset(preset, entry.mode);
    }

    const rowTitle =
      root.querySelector<HTMLElement>(`[data-patch-row="${entry.slug}"] [data-patch-title]`)
        ?.textContent?.trim() || entry.slug;

    if (titleEl) {
      titleEl.textContent = rowTitle;
    }
    if (presetEl) {
      presetEl.textContent = preset.name;
    }

    const activeLedKey = signalState === 'active' ? preset.led.activeState : preset.led.idleState;
    const badge = ledBadgeInfo(activeLedKey);
    if (ledPillEl) {
      ledPillEl.setAttribute('data-led', badge.pillColor);
      ledPillEl.textContent = `${badge.symbol} ${badge.text}`;
    }
    if (ledDescEl) {
      ledDescEl.textContent = signalState === 'active' ? preset.led.activeDesc : preset.led.idleDesc;
    }
    if (openLinkEl) {
      openLinkEl.setAttribute('href', withBase(`/patches/${entry.slug}/`));
    }
  };

  const syncRowHighlights = (): void => {
    for (const row of rows) {
      const slug = row.getAttribute('data-patch-row') ?? '';
      row.classList.toggle('is-previewed', slug === previewedSlug);
      row.classList.toggle('is-pinned', slug === pinnedSlug);
    }
    for (const btn of pinBtns) {
      const slug = btn.getAttribute('data-pin-patch') ?? '';
      btn.setAttribute('aria-pressed', String(slug === pinnedSlug));
    }
  };

  const applyFilter = (mode: ModeFilter): void => {
    for (const btn of filterBtns) {
      const btnMode = btn.getAttribute('data-mode-filter');
      btn.setAttribute('aria-pressed', String(btnMode === mode));
    }
    let firstVisibleSlug: string | null = null;
    for (const row of rows) {
      const rowMode = row.getAttribute('data-patch-mode');
      const matches = mode === 'all' || rowMode === mode;
      row.hidden = !matches;
      if (matches && !firstVisibleSlug) {
        firstVisibleSlug = row.getAttribute('data-patch-row');
      }
    }

    const pinnedRow = rows.find((r) => r.getAttribute('data-patch-row') === pinnedSlug);
    if (pinnedRow?.hidden && firstVisibleSlug) {
      pinnedSlug = firstVisibleSlug;
      renderPreview(pinnedSlug);
      syncRowHighlights();
    }
  };

  for (const btn of filterBtns) {
    btn.addEventListener('click', () => {
      const mode = (btn.getAttribute('data-mode-filter') as ModeFilter | null) ?? 'all';
      applyFilter(mode);
    });
  }

  for (const row of rows) {
    const slug = row.getAttribute('data-patch-row') ?? '';
    if (!slug) continue;

    row.addEventListener('pointerenter', () => {
      renderPreview(slug);
      syncRowHighlights();
    });
    row.addEventListener('pointerleave', () => {
      renderPreview(pinnedSlug);
      syncRowHighlights();
    });
    row.addEventListener('focusin', () => {
      renderPreview(slug);
      syncRowHighlights();
    });
  }

  for (const btn of pinBtns) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const slug = btn.getAttribute('data-pin-patch') ?? '';
      if (!slug) return;
      pinnedSlug = slug;
      renderPreview(pinnedSlug);
      syncRowHighlights();
    });
  }

  for (const btn of signalBtns) {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-signal-btn') === 'active' ? 'active' : 'idle';
      signalState = next;
      for (const sibling of signalBtns) {
        sibling.setAttribute('aria-pressed', String(sibling === btn));
      }
      renderPreview(previewedSlug);
    });
  }

  renderPreview(pinnedSlug);
  syncRowHighlights();
}
