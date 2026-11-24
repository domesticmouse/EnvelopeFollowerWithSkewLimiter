import type { LightboxItem } from '../components/zoom-pan-viewer.ts';
import {
  BUILD_CHECKLISTS_CATALOG,
  getBuildChecklistBySlug,
  type ChecklistSlug,
} from '../data/build-checklists.ts';
import {
  clearAllChecklistProgress,
  clearChecklistProgress,
  computeAllChecklistsProgress,
  loadCheckedItemIds,
  saveCheckedItemIds,
} from './checklist-storage.ts';
import { wireBackdropLightDismiss } from './dialog-chrome.ts';

/** Optional dependencies injected cleanly for deterministic unit tests. */
export interface ChecklistControllerOptions {
  root?: Document | HTMLElement;
  storage?: Storage | null;
  copyText?: (text: string) => Promise<void>;
  onOpenLightbox?: (items: LightboxItem[], startIndex: number) => void;
}

function defaultCopyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Clipboard API unavailable'));
}

function syncRailBadges(root: Document | HTMLElement, storage?: Storage | null): void {
  const summary = computeAllChecklistsProgress(storage);
  for (const step of summary.steps) {
    for (const badge of root.querySelectorAll<HTMLElement>(
      `[data-rail-slug="${step.slug}"]`,
    )) {
      badge.textContent = `${step.done} / ${step.total}`;
      badge.classList.toggle('is-complete', step.total > 0 && step.done >= step.total);
    }
  }
}

function findDirectPlacementCard(li: HTMLElement): HTMLElement | null {
  for (const card of li.querySelectorAll<HTMLElement>('[data-placement-card]')) {
    if (card.closest('li[data-checklist-item]') === li) {
      return card;
    }
  }
  return null;
}

function wireConfirmResetDialog(
  dialog: HTMLDialogElement | null,
  trigger: HTMLElement | null,
  onConfirm: () => void,
  signal: AbortSignal,
): void {
  if (!dialog || !trigger) {
    return;
  }
  wireBackdropLightDismiss(dialog, signal);

  let previousActive: { focus?: () => void; isConnected?: boolean } | null = null;
  trigger.addEventListener(
    'click',
    () => {
      const active = dialog.ownerDocument?.activeElement as
        | { focus?: () => void; isConnected?: boolean }
        | null;
      previousActive = active && typeof active.focus === 'function' ? active : trigger;
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    },
    { signal },
  );

  dialog.addEventListener(
    'close',
    () => {
      const decision = dialog.returnValue;
      dialog.returnValue = '';
      if (decision === 'confirm') {
        onConfirm();
      }
      if (previousActive && previousActive.isConnected && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
      previousActive = null;
    },
    { signal },
  );
}

/**
 * Hydrates an interactive Build Checklist detail page (/build/01..05):
 * localStorage persistence, independent parent/child checkboxes, Hide completed filter,
 * 02/04 placement photo collapse + reveal, gallery lightbox, copy buttons, and Reset modal.
 */
export function initChecklistDetailPage(options: ChecklistControllerOptions = {}): () => void {
  const root = options.root ?? document;
  const container = root.querySelector<HTMLElement>('[data-checklist-page]');
  if (!container) {
    return () => {};
  }

  const slug = container.getAttribute('data-checklist-page') as ChecklistSlug;
  const meta = getBuildChecklistBySlug(slug);
  if (!meta) {
    return () => {};
  }

  const controller = new AbortController();
  const { signal } = controller;
  const checkboxes = [...container.querySelectorAll<HTMLInputElement>('[data-checklist-checkbox]')];
  const hideToggle = container.querySelector<HTMLInputElement>('[data-hide-completed]');
  const summaryEl = container.querySelector<HTMLElement>('[data-checklist-summary]');
  const meterBarEl = container.querySelector<HTMLElement>('[data-checklist-meter-bar]');
  const liveEl = container.querySelector<HTMLElement>('[data-checklist-live]');

  let checkedIds = loadCheckedItemIds(slug, options.storage);

  const syncDomFromState = (): void => {
    const hideCompleted = Boolean(hideToggle?.checked);
    let doneCount = 0;

    for (const cb of checkboxes) {
      const itemId = cb.getAttribute('data-item-id') ?? '';
      const isChecked = checkedIds.has(itemId);
      cb.checked = isChecked;
      if (isChecked) {
        doneCount += 1;
      }

      const li = cb.closest<HTMLElement>('li[data-checklist-item]');
      if (li) {
        li.classList.toggle('is-checked', isChecked);
        const card = findDirectPlacementCard(li);
        if (card) {
          card.classList.toggle('is-collapsed', isChecked);
          if (!isChecked) {
            card.classList.remove('is-expanded-override');
          }
          const revealBtn = card.querySelector<HTMLButtonElement>('[data-placement-reveal]');
          if (revealBtn) {
            const expandedOverride = card.classList.contains('is-expanded-override');
            revealBtn.hidden = !isChecked || expandedOverride;
            revealBtn.setAttribute('aria-expanded', expandedOverride ? 'true' : 'false');
          }
        }
      }
    }

    // Apply Hide completed bottom-up so parent stays visible while any child remains unchecked
    for (const li of [...container.querySelectorAll<HTMLElement>('li[data-checklist-item]')].reverse()) {
      const ownCb = li.querySelector<HTMLInputElement>(':scope > label [data-checklist-checkbox]');
      const ownChecked = Boolean(ownCb?.checked);
      const hasVisibleChild = Boolean(
        li.querySelector('li[data-checklist-item]:not([data-hidden-completed="true"])'),
      );
      if (hideCompleted && ownChecked && !hasVisibleChild) {
        li.setAttribute('data-hidden-completed', 'true');
      } else {
        li.removeAttribute('data-hidden-completed');
      }
    }

    const total = checkboxes.length || meta.totalItems;
    const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    if (summaryEl) {
      summaryEl.textContent = `${doneCount} / ${total} completed (${percent}%)`;
    }
    if (meterBarEl) {
      meterBarEl.style.width = `${percent}%`;
    }
    syncRailBadges(root, options.storage);
  };

  for (const cb of checkboxes) {
    cb.addEventListener(
      'change',
      () => {
        const itemId = cb.getAttribute('data-item-id') ?? '';
        if (!itemId) return;
        if (cb.checked) {
          checkedIds.add(itemId);
        } else {
          checkedIds.delete(itemId);
        }
        saveCheckedItemIds(slug, checkedIds, options.storage);
        syncDomFromState();
      },
      { signal },
    );
  }

  hideToggle?.addEventListener('change', syncDomFromState, { signal });

  for (const revealBtn of container.querySelectorAll<HTMLButtonElement>('[data-placement-reveal]')) {
    revealBtn.addEventListener(
      'click',
      () => {
        const card = revealBtn.closest<HTMLElement>('[data-placement-card]');
        if (!card) return;
        card.classList.toggle('is-expanded-override');
        syncDomFromState();
      },
      { signal },
    );
  }

  // Build ordered gallery items across all checklist lightbox triggers on this page
  const lightboxButtons = [...container.querySelectorAll<HTMLButtonElement>('button[data-lightbox-src]')];
  const galleryItems: LightboxItem[] = lightboxButtons.map((btn) => {
    const width = Number(btn.getAttribute('data-lightbox-width')) || undefined;
    const height = Number(btn.getAttribute('data-lightbox-height')) || undefined;
    const alt = btn.getAttribute('data-lightbox-alt') ?? 'Checklist reference photo';
    return {
      src: btn.getAttribute('data-lightbox-src') ?? '',
      alt,
      caption: alt,
      width,
      height,
    };
  });

  lightboxButtons.forEach((btn, idx) => {
    btn.addEventListener(
      'click',
      () => {
        if (options.onOpenLightbox) {
          options.onOpenLightbox(galleryItems, idx);
          return;
        }
        void import('../components/zoom-pan-viewer.ts').then(({ openFullscreenLightbox }) => {
          openFullscreenLightbox({
            items: galleryItems,
            startIndex: idx,
            mode: 'gallery',
            title: `${meta.shortTitle} · Reference Photos`,
          });
        });
      },
      { signal },
    );
  });

  const copyFn = options.copyText ?? defaultCopyText;
  for (const copyBtn of container.querySelectorAll<HTMLButtonElement>('[data-copy-trigger]')) {
    const defaultLabel = copyBtn.textContent?.trim() || 'Copy';
    let resetTimer: number | undefined;
    copyBtn.addEventListener(
      'click',
      () => {
        const text = copyBtn.getAttribute('data-copy-text') ?? '';
        if (!text) return;
        void copyFn(text).then(
          () => {
            copyBtn.textContent = 'Copied';
            copyBtn.classList.add('is-copied');
            if (liveEl) {
              liveEl.textContent = 'Copied snippet to clipboard.';
            }
            if (resetTimer !== undefined) {
              globalThis.clearTimeout(resetTimer);
            }
            resetTimer = globalThis.setTimeout(() => {
              copyBtn.textContent = defaultLabel;
              copyBtn.classList.remove('is-copied');
            }, 1800) as unknown as number;
          },
          () => {
            copyBtn.textContent = 'Copy manually';
          },
        );
      },
      { signal },
    );
  }

  wireConfirmResetDialog(
    container.querySelector<HTMLDialogElement>('[data-reset-dialog]') ??
      root.querySelector<HTMLDialogElement>('[data-reset-dialog]'),
    container.querySelector<HTMLElement>('[data-reset-open]'),
    () => {
      clearChecklistProgress(slug, options.storage);
      checkedIds = new Set();
      if (hideToggle) {
        hideToggle.checked = false;
      }
      for (const card of container.querySelectorAll<HTMLElement>('[data-placement-card]')) {
        card.classList.remove('is-expanded-override');
      }
      syncDomFromState();
      if (liveEl) {
        liveEl.textContent = `Cleared saved progress for ${meta.shortTitle}.`;
      }
    },
    signal,
  );

  syncDomFromState();
  return () => controller.abort();
}

/**
 * Hydrates /build/ overview page: computes aggregate X / 211 completion across all 6 steps,
 * updates per-step status badges & progress meters, and wires global Reset All modal confirmation.
 */
export function initBuildHubPage(options: ChecklistControllerOptions = {}): () => void {
  const root = options.root ?? document;
  const hub = root.querySelector<HTMLElement>('[data-build-hub]');
  if (!hub) {
    return () => {};
  }

  const controller = new AbortController();
  const { signal } = controller;

  const refresh = (): void => {
    const summary = computeAllChecklistsProgress(options.storage);
    const totalEl = hub.querySelector<HTMLElement>('[data-hub-total]');
    const totalBarEl = hub.querySelector<HTMLElement>('[data-hub-total-bar]');
    const percentEl = hub.querySelector<HTMLElement>('[data-hub-percent]');
    if (totalEl) {
      totalEl.textContent = `${summary.totalDone} / ${summary.totalItems}`;
    }
    if (percentEl) {
      percentEl.textContent = `${summary.percent}% complete`;
    }
    if (totalBarEl) {
      totalBarEl.style.width = `${summary.percent}%`;
    }

    for (const step of summary.steps) {
      const countEl = hub.querySelector<HTMLElement>(`[data-hub-step-count="${step.slug}"]`);
      const statusEl = hub.querySelector<HTMLElement>(`[data-hub-step-status="${step.slug}"]`);
      const barEl = hub.querySelector<HTMLElement>(`[data-hub-step-bar="${step.slug}"]`);
      if (countEl) {
        countEl.textContent = `${step.done} / ${step.total}`;
      }
      if (barEl) {
        barEl.style.width = `${step.percent}%`;
      }
      if (statusEl) {
        if (step.done === 0) {
          statusEl.textContent = 'Not started';
          statusEl.setAttribute('data-status', 'pending');
        } else if (step.done >= step.total) {
          statusEl.textContent = 'Complete';
          statusEl.setAttribute('data-status', 'complete');
        } else {
          statusEl.textContent = 'In progress';
          statusEl.setAttribute('data-status', 'active');
        }
      }
    }

    syncRailBadges(root, options.storage);
  };

  wireConfirmResetDialog(
    hub.querySelector<HTMLDialogElement>('[data-hub-reset-dialog]') ??
      root.querySelector<HTMLDialogElement>('[data-hub-reset-dialog]'),
    hub.querySelector<HTMLElement>('[data-hub-reset-open]'),
    () => {
      clearAllChecklistProgress(
        BUILD_CHECKLISTS_CATALOG.map((s) => s.slug),
        options.storage,
      );
      refresh();
    },
    signal,
  );

  refresh();
  return () => controller.abort();
}
