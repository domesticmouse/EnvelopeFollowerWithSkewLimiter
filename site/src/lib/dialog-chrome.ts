/** Options for configuring browser-capability detection in initDialogChrome. */
export interface DialogChromeOptions {
  supportsClosedBy?: boolean;
  supportsCommandFor?: boolean;
  loadInvokersPolyfill?: () => Promise<unknown>;
}

/** Returned cleanup handle for removing listeners attached by initDialogChrome. */
export interface DialogChromeHandle {
  destroy: () => void;
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
): DialogChromeHandle {
  const cleanups: Array<() => void> = [];

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
    const handleClose = () => {
      dialog.returnValue = '';
      setTriggersExpanded(doc, dialog.id, false);
    };
    const handleCommand = () => {
      queueMicrotask(() => {
        setTriggersExpanded(doc, dialog.id, dialog.open);
      });
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('command', handleCommand);
    cleanups.push(() => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('command', handleCommand);
    });

    if (!supportsClosedBy && dialog.getAttribute('closedby') === 'any') {
      let pressedOutside = false;

      const handlePointerDown = (event: PointerEvent) => {
        if (!dialog.open) {
          pressedOutside = false;
          return;
        }
        pressedOutside = isPointerOutsideDialog(event, dialog);
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (dialog.open && pressedOutside && isPointerOutsideDialog(event, dialog)) {
          pressedOutside = false;
          dialog.close();
          return;
        }
        pressedOutside = false;
      };

      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('pointerup', handlePointerUp);
      cleanups.push(() => {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('pointerup', handlePointerUp);
      });
    }
  }

  for (const trigger of doc.querySelectorAll<HTMLButtonElement>(
    'button[command="show-modal"][commandfor]',
  )) {
    const handleTriggerClick = () => {
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
    };

    trigger.addEventListener('click', handleTriggerClick);
    cleanups.push(() => trigger.removeEventListener('click', handleTriggerClick));
  }

  return {
    destroy: () => {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
  };
}
