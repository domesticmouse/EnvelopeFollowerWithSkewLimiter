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
      dialog.returnValue = '';
      setTriggersExpanded(doc, dialog.id, false);
    });
    dialog.addEventListener('command', () => {
      queueMicrotask(() => {
        setTriggersExpanded(doc, dialog.id, dialog.open);
      });
    });

    if (!supportsClosedBy && dialog.getAttribute('closedby') === 'any') {
      let pressedOutside = false;

      dialog.addEventListener('pointerdown', (event) => {
        if (!dialog.open) {
          pressedOutside = false;
          return;
        }
        pressedOutside = isPointerOutsideDialog(event, dialog);
      });

      dialog.addEventListener('pointerup', (event) => {
        if (dialog.open && pressedOutside && isPointerOutsideDialog(event, dialog)) {
          pressedOutside = false;
          dialog.close();
          return;
        }
        pressedOutside = false;
      });
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
