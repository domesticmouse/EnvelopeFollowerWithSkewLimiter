import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { initDialogChrome, showModalSafe, wireBackdropLightDismiss } from '../src/lib/dialog-chrome.ts';

function createChromeFixture() {
  const win = new Window();
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = `
    <button
      id="menu-btn"
      type="button"
      command="show-modal"
      commandfor="mobile-nav-drawer"
      aria-controls="mobile-nav-drawer"
      aria-expanded="false"
    >
      Menu
    </button>
    <dialog id="mobile-nav-drawer" closedby="any" aria-labelledby="mobile-nav-title">
      <h1 id="mobile-nav-title">Navigation</h1>
      <form method="dialog">
        <button id="close-btn" type="submit" autofocus>Close</button>
      </form>
    </dialog>
  `;

  const dialog = doc.getElementById('mobile-nav-drawer') as HTMLDialogElement;
  const trigger = doc.getElementById('menu-btn') as HTMLButtonElement;

  let isOpen = false;
  Object.defineProperty(dialog, 'open', {
    configurable: true,
    get: () => isOpen,
  });

  dialog.showModal = vi.fn(() => {
    isOpen = true;
  });
  dialog.close = vi.fn((returnValue?: string) => {
    if (returnValue !== undefined) {
      dialog.returnValue = returnValue;
    }
    isOpen = false;
    dialog.dispatchEvent(new win.Event('close') as unknown as Event);
  });

  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 300,
    bottom: 800,
    width: 300,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return { win, doc, dialog, trigger };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function dispatchPointer(
  target: Element,
  win: Window,
  type: string,
  clientX: number,
  clientY: number,
): void {
  const event = new win.PointerEvent(type, { clientX, clientY, bubbles: true });
  target.dispatchEvent(event as unknown as Event);
}

describe('dialog-chrome accessibility and fallback helper', () => {
  it('closes dialog[closedby="any"] when pointerdown and pointerup both occur outside dialog bounds and closedby is unsupported', () => {
    const { win, doc, dialog } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: false,
      supportsCommandFor: true,
    });

    dialog.showModal();
    expect(dialog.open).toBe(true);

    dispatchPointer(dialog, win, 'pointerdown', 350, 120);
    dispatchPointer(dialog, win, 'pointerup', 360, 120);

    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(false);
  });

  it('does not close when pointerdown starts inside dialog and pointerup ends outside (text selection drag)', () => {
    const { win, doc, dialog } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: false,
      supportsCommandFor: true,
    });

    dialog.showModal();

    dispatchPointer(dialog, win, 'pointerdown', 120, 120);
    dispatchPointer(dialog, win, 'pointerup', 360, 120);

    expect(dialog.close).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it('does not close when pointerdown and pointerup occur inside dialog bounds', () => {
    const { win, doc, dialog } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: false,
      supportsCommandFor: true,
    });

    dialog.showModal();

    dispatchPointer(dialog, win, 'pointerdown', 100, 100);
    dispatchPointer(dialog, win, 'pointerup', 140, 140);

    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('does not attach redundant light-dismiss fallback when closedby is natively supported', () => {
    const { win, doc, dialog } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: true,
      supportsCommandFor: true,
    });

    dialog.showModal();

    dispatchPointer(dialog, win, 'pointerdown', 400, 120);
    dispatchPointer(dialog, win, 'pointerup', 400, 120);

    expect(dialog.close).not.toHaveBeenCalled();
  });

  it('clears dialog.returnValue and resets trigger aria-expanded to false on close', () => {
    const { doc, dialog, trigger } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: true,
      supportsCommandFor: true,
    });

    trigger.setAttribute('aria-expanded', 'true');
    dialog.showModal();
    dialog.close('confirm');

    expect(dialog.returnValue).toBe('');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('loads invokers-polyfill lazily only when HTMLButtonElement.prototype.commandForElement is absent', () => {
    const first = createChromeFixture();
    const loadPolyfillMock = vi.fn(async () => ({}));

    initDialogChrome(first.doc, {
      supportsClosedBy: true,
      supportsCommandFor: true,
      loadInvokersPolyfill: loadPolyfillMock,
    });
    expect(loadPolyfillMock).not.toHaveBeenCalled();

    const second = createChromeFixture();
    initDialogChrome(second.doc, {
      supportsClosedBy: true,
      supportsCommandFor: false,
      loadInvokersPolyfill: loadPolyfillMock,
    });
    expect(loadPolyfillMock).toHaveBeenCalledTimes(1);
  });

  it('opens modal via showModal fallback and sets aria-expanded="true" when invokers are unsupported', () => {
    const { doc, dialog, trigger } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: true,
      supportsCommandFor: false,
      loadInvokersPolyfill: async () => ({}),
    });

    trigger.click();

    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    dialog.close();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('syncs aria-expanded="true" when native invoker commands dispatch command and open the dialog', async () => {
    const { win, doc, dialog, trigger } = createChromeFixture();
    initDialogChrome(doc, {
      supportsClosedBy: true,
      supportsCommandFor: true,
    });

    // Simulate native browser invoker activation sequence after click completes
    dialog.dispatchEvent(new win.Event('command') as unknown as Event);
    dialog.showModal();
    await Promise.resolve();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    dialog.close();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('uses showModalSafe fallback when supportsCommandFor is false and showModal throws or is missing', () => {
    const first = createChromeFixture();
    first.dialog.showModal = vi.fn(() => {
      throw new Error('NotSupportedError');
    });
    initDialogChrome(first.doc, {
      supportsClosedBy: true,
      supportsCommandFor: false,
      loadInvokersPolyfill: async () => ({}),
    });

    first.trigger.click();
    expect(first.dialog.hasAttribute('open')).toBe(true);

    const second = createChromeFixture();
    (second.dialog as unknown as { showModal?: () => void }).showModal = undefined;
    initDialogChrome(second.doc, {
      supportsClosedBy: true,
      supportsCommandFor: false,
      loadInvokersPolyfill: async () => ({}),
    });

    second.trigger.click();
    expect(second.dialog.hasAttribute('open')).toBe(true);
  });

  it('showModalSafe sets open attribute when showModal is missing, throws, or is a no-op', () => {
    const win = new Window();
    const doc = win.document as unknown as Document;

    const missingDlg = doc.createElement('dialog') as HTMLDialogElement;
    (missingDlg as unknown as { showModal?: () => void }).showModal = undefined;
    showModalSafe(missingDlg);
    expect(missingDlg.hasAttribute('open')).toBe(true);

    const throwingDlg = doc.createElement('dialog') as HTMLDialogElement;
    throwingDlg.showModal = vi.fn(() => {
      throw new Error('showModal failed');
    });
    showModalSafe(throwingDlg);
    expect(throwingDlg.hasAttribute('open')).toBe(true);

    const noopDlg = doc.createElement('dialog') as HTMLDialogElement;
    Object.defineProperty(noopDlg, 'open', { configurable: true, get: () => false });
    noopDlg.showModal = vi.fn();
    showModalSafe(noopDlg);
    expect(noopDlg.hasAttribute('open')).toBe(true);
  });

  it('wireBackdropLightDismiss short-circuits when HTMLDialogElement.prototype supports closedBy', () => {
    const { win, dialog } = createChromeFixture();
    const hadClosedBy = Object.prototype.hasOwnProperty.call(win.HTMLDialogElement.prototype, 'closedBy');
    const prevDescriptor = Object.getOwnPropertyDescriptor(win.HTMLDialogElement.prototype, 'closedBy');

    const globalHadProto = 'HTMLDialogElement' in globalThis;
    const prevGlobalProto = (globalThis as Record<string, unknown>).HTMLDialogElement;
    (globalThis as Record<string, unknown>).HTMLDialogElement = win.HTMLDialogElement;
    Object.defineProperty(win.HTMLDialogElement.prototype, 'closedBy', {
      configurable: true,
      get: () => 'any',
    });

    try {
      wireBackdropLightDismiss(dialog);
      dialog.showModal();
      dispatchPointer(dialog, win, 'pointerdown', 400, 120);
      dispatchPointer(dialog, win, 'pointerup', 400, 120);
      expect(dialog.close).not.toHaveBeenCalled();
    } finally {
      if (hadClosedBy && prevDescriptor) {
        Object.defineProperty(win.HTMLDialogElement.prototype, 'closedBy', prevDescriptor);
      } else {
        delete (win.HTMLDialogElement.prototype as unknown as Record<string, unknown>).closedBy;
      }
      if (globalHadProto) {
        (globalThis as Record<string, unknown>).HTMLDialogElement = prevGlobalProto;
      } else {
        delete (globalThis as Record<string, unknown>).HTMLDialogElement;
      }
    }
  });

  it('preserves returnValue for data-managed-dialog while resetting returnValue for unmanaged dialogs', () => {
    const { win, doc, dialog } = createChromeFixture();
    const managed = doc.createElement('dialog') as HTMLDialogElement;
    managed.id = 'managed-dlg';
    managed.setAttribute('data-managed-dialog', '');
    managed.returnValue = 'keep-me';
    doc.body.appendChild(managed);

    initDialogChrome(doc, {
      supportsClosedBy: true,
      supportsCommandFor: true,
    });

    dialog.showModal();
    dialog.close('confirm');
    expect(dialog.returnValue).toBe('');

    managed.dispatchEvent(new win.Event('close') as unknown as Event);
    expect(managed.returnValue).toBe('keep-me');
  });
});
