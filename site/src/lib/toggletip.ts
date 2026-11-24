export interface ToggletipInitOptions {
  supportsHintPopover?: boolean;
  supportsInterestFor?: boolean;
}

function detectHintSupport(doc: Document): boolean {
  if (typeof HTMLElement === 'undefined' || !('popover' in HTMLElement.prototype)) {
    return false;
  }
  const probe = doc.createElement('div') as HTMLElement & { popover?: string };
  probe.popover = 'hint';
  return probe.popover === 'hint';
}

function showPopoverSafe(el: HTMLElement): void {
  const target = el as HTMLElement & { showPopover?: () => void; matches: (s: string) => boolean };
  if (typeof target.showPopover === 'function') {
    try {
      if (!target.matches(':popover-open')) {
        target.showPopover();
      }
    } catch {
      // Fallback for jsdom/happy-dom environments lacking full Popover API
      target.classList.add(':popover-open');
    }
  } else {
    target.classList.add(':popover-open');
  }
}

function hidePopoverSafe(el: HTMLElement): void {
  const target = el as HTMLElement & { hidePopover?: () => void; matches: (s: string) => boolean };
  if (typeof target.hidePopover === 'function') {
    try {
      if (target.matches(':popover-open')) {
        target.hidePopover();
      }
    } catch {
      target.classList.remove(':popover-open');
    }
  } else {
    target.classList.remove(':popover-open');
  }
}

/**
 * Initialize accessible [popover="hint"] toggletips:
 * - Sets role="tooltip" on hints and syncs aria-expanded from capturing toggle events
 * - Downgrades popover="hint" to popover="auto" in a capturing beforetoggle listener when hint is unsupported
 * - Provides lightweight hover/focus interest fallback when native interestfor is missing
 */
export function initToggletips(
  doc: Document = document,
  options?: ToggletipInitOptions,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const supportsHintPopover = options?.supportsHintPopover ?? detectHintSupport(doc);
  const supportsInterestFor =
    options?.supportsInterestFor ??
    (typeof HTMLButtonElement !== 'undefined' && 'interestForElement' in HTMLButtonElement.prototype);

  const ownedTriggers = new WeakSet<Element>();

  for (const trigger of doc.querySelectorAll<HTMLElement>('[interestfor]')) {
    const targetId = trigger.getAttribute('interestfor');
    if (!targetId) continue;
    const hint = doc.getElementById(targetId);
    if (!hint || hint.getAttribute('popover') !== 'hint') continue;

    if (!hint.hasAttribute('role')) {
      hint.setAttribute('role', 'tooltip');
    }

    const opensOnActivation =
      trigger.getAttribute('popovertarget') === targetId ||
      trigger.getAttribute('commandfor') === targetId;

    if (opensOnActivation && !trigger.hasAttribute('aria-expanded')) {
      let isOpen = false;
      try {
        isOpen = hint.matches(':popover-open');
      } catch {
        isOpen = hint.classList.contains(':popover-open');
      }
      trigger.setAttribute('aria-expanded', String(isOpen));
      ownedTriggers.add(trigger);
    }

    if (!supportsInterestFor) {
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          hidePopoverSafe(hint);
        }, 120);
      };
      const openNow = () => {
        clearTimeout(closeTimer);
        showPopoverSafe(hint);
      };

      trigger.addEventListener('pointerenter', openNow, { signal });
      trigger.addEventListener('pointerleave', scheduleClose, { signal });
      trigger.addEventListener('focus', openNow, { signal });
      trigger.addEventListener('blur', scheduleClose, { signal });
      hint.addEventListener('pointerenter', () => clearTimeout(closeTimer), { signal });
      hint.addEventListener('pointerleave', scheduleClose, { signal });
    }
  }

  if (!supportsHintPopover) {
    doc.addEventListener(
      'beforetoggle',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target || typeof target.getAttribute !== 'function') return;
        const newState = (event as Event & { newState?: string }).newState;
        const isToggletip =
          target.getAttribute('popover') === 'hint' &&
          Boolean(target.id) &&
          Boolean(doc.querySelector(`[popovertarget="${target.id.replaceAll('"', '\\"')}"]`));

        if (newState === 'open' && isToggletip) {
          target.setAttribute('popover', 'auto');
        }
      },
      { capture: true, signal },
    );
  }

  doc.addEventListener(
    'toggle',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.id) return;
      const newState = (event as Event & { newState?: string }).newState;
      if (newState !== 'open' && newState !== 'closed') return;

      for (const trigger of doc.querySelectorAll<HTMLElement>(
        `[interestfor="${target.id.replaceAll('"', '\\"')}"]`,
      )) {
        if (ownedTriggers.has(trigger)) {
          trigger.setAttribute('aria-expanded', String(newState === 'open'));
        }
      }
    },
    { capture: true, signal },
  );

  return () => controller.abort();
}
