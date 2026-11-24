/** Options for configuring browser-capability detection in initDialogChrome. */
export interface DialogChromeOptions {
  supportsClosedBy?: boolean;
  supportsCommandFor?: boolean;
  loadInvokersPolyfill?: () => Promise<unknown>;
}

function isPointerOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

function setTriggersExpanded(doc: Document, dialogId: string, expanded: boolean): void {
  if (!dialogId) {
    return;
  }
  const value = expanded ? 'true' : 'false';
  for (const btn of doc.querySelectorAll<HTMLButtonElement>(`button[commandfor="${dialogId}"]`)) {
    btn.setAttribute('aria-expanded', value);
  }
}

/** Safely opens a native `<dialog>` modal with `open` attribute fallback in limited test DOMs. */
export function showModalSafe(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  } else {
    dialog.setAttribute('open', '');
  }
  if (!dialog.open && !dialog.hasAttribute('open')) {
    dialog.setAttribute('open', '');
  }
}

/**
 * Attaches Safari `closedby="any"` press-and-release outside backdrop dismissal to a `<dialog>`.
 * Requires both pointerdown and pointerup outside bounds so drag-selections ending outside don't dismiss.
 */
export function wireBackdropLightDismiss(
  dialog: HTMLDialogElement,
  signal?: AbortSignal,
): void {
  const supportsClosedBy =
    typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
  if (supportsClosedBy || dialog.getAttribute('closedby') !== 'any') {
    return;
  }

  let pressedOutside = false;
  dialog.addEventListener(
    'pointerdown',
    (event) => {
      if (!dialog.open) {
        pressedOutside = false;
        return;
      }
      pressedOutside = isPointerOutsideDialog(event, dialog);
    },
    signal ? { signal } : undefined,
  );

  dialog.addEventListener(
    'pointerup',
    (event) => {
      if (dialog.open && pressedOutside && isPointerOutsideDialog(event, dialog)) {
        pressedOutside = false;
        dialog.close();
        return;
      }
      pressedOutside = false;
    },
    signal ? { signal } : undefined,
  );
}

/**
 * Wire accessible modal <dialog> returnValue cleanup, aria-expanded sync,
 * conditional invokers-polyfill loading, and Safari closedby="any" light-dismiss fallback.
 */
export function initDialogChrome(
  doc: Document = document,
  options?: DialogChromeOptions,
): void {
  const supportsClosedBy =
    options?.supportsClosedBy ??
    (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype);
  const supportsCommandFor =
    options?.supportsCommandFor ??
    (typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype);

  if (!supportsCommandFor) {
    const loadPolyfill = options?.loadInvokersPolyfill ?? (() => import('invokers-polyfill'));
    void loadPolyfill();
  }

  for (const dialog of doc.querySelectorAll<HTMLDialogElement>('dialog')) {
    dialog.addEventListener('close', () => {
      if (!dialog.hasAttribute('data-managed-dialog')) {
        dialog.returnValue = '';
      }
      setTriggersExpanded(doc, dialog.id, false);
    });
    dialog.addEventListener('command', () => {
      queueMicrotask(() => {
        setTriggersExpanded(doc, dialog.id, dialog.open);
      });
    });

    if (!supportsClosedBy && !dialog.hasAttribute('data-managed-dialog')) {
      wireBackdropLightDismiss(dialog);
    }
  }

  for (const trigger of doc.querySelectorAll<HTMLButtonElement>(
    'button[command="show-modal"][commandfor]',
  )) {
    trigger.addEventListener('click', () => {
      const targetId = trigger.getAttribute('commandfor');
      if (!targetId) {
        return;
      }
      const target = doc.getElementById(targetId);
      if (!target || target.localName !== 'dialog') {
        return;
      }
      const dialog = target as HTMLDialogElement;
      if (!supportsCommandFor && !dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      setTriggersExpanded(doc, dialog.id, dialog.open);
      queueMicrotask(() => {
        setTriggersExpanded(doc, dialog.id, dialog.open);
      });
    });
  }
}
