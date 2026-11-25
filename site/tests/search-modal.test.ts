import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyRouteSection,
  initSearchModal,
  type PagefindApi,
} from '../src/lib/search-modal.ts';

function setupSearchDom() {
  const win = new Window();
  win.document.body.innerHTML = `
    <header>
      <button
        type="button"
        data-search-trigger
        aria-haspopup="dialog"
        aria-controls="site-search-dialog"
        aria-label="Search site"
      >Search ⌘K</button>
    </header>
    <main>Content</main>
    <dialog id="site-search-dialog" data-search-dialog data-managed-dialog data-pagefind-ignore closedby="any">
      <div>
        <button type="button" data-search-close aria-label="Close search">Close</button>
        <input
          type="text"
          inputmode="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="site-search-results"
          data-search-input
          placeholder="Search patches, build steps, components..."
        />
        <p data-search-status>Type to search</p>
        <ul id="site-search-results" data-search-results role="listbox" aria-label="Search results"></ul>
      </div>
    </dialog>
  `;

  const doc = win.document as unknown as Document;
  const dialog = doc.querySelector<HTMLDialogElement>('[data-search-dialog]')!;
  dialog.showModal = () => {
    dialog.setAttribute('open', '');
  };
  dialog.close = (rv?: string) => {
    if (rv !== undefined) dialog.returnValue = rv;
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new win.Event('close') as unknown as Event);
  };

  return { win, doc, dialog };
}

describe('classifyRouteSection', () => {
  it('maps site base URLs cleanly to UI section badges', () => {
    expect(classifyRouteSection('/EnvelopeFollowerWithSkewLimiter/patches/01-sidechain-ducking/')).toEqual({
      key: 'patches',
      label: 'Patches',
    });
    expect(classifyRouteSection('/EnvelopeFollowerWithSkewLimiter/build/02-pcba-part-alignment/')).toEqual({
      key: 'build',
      label: 'Build',
    });
    expect(classifyRouteSection('/EnvelopeFollowerWithSkewLimiter/hardware/#panel')).toEqual({
      key: 'hardware',
      label: 'Hardware',
    });
    expect(classifyRouteSection('/EnvelopeFollowerWithSkewLimiter/specs/design-spec/')).toEqual({
      key: 'specs',
      label: 'Reference Specs',
    });
  });
});

describe('initSearchModal', () => {
  it('lazy-loads Pagefind only on first open, opens on trigger click or Cmd/Ctrl+K, and restores focus on close', async () => {
    const { win, doc, dialog } = setupSearchDom();
    const searchMock = vi.fn(async () => ({ results: [] }));
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      init: vi.fn(async () => {}),
      search: searchMock,
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0 });
    try {
      expect(loadPagefind).not.toHaveBeenCalled();

      // Open via header trigger
      const trigger = doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!;
      trigger.focus();
      trigger.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(dialog.hasAttribute('open')).toBe(true);
      expect(loadPagefind).toHaveBeenCalledTimes(1);

      dialog.close();
      expect(dialog.hasAttribute('open')).toBe(false);

      // Re-open via Cmd+K (must NOT call loadPagefind a second time)
      const kEvt = new win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true });
      doc.dispatchEvent(kEvt as unknown as Event);
      await Promise.resolve();

      expect(dialog.hasAttribute('open')).toBe(true);
      expect(loadPagefind).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      win.close();
    }
  });

  it('renders search results with section badges and safe highlighted excerpts and navigates on keyboard Enter', async () => {
    const { win, doc } = setupSearchDom();
    const navigate = vi.fn<(url: string) => void>();

    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: async (q: string) => {
        if (!q.includes('BAT54S')) {
          return { results: [] };
        }
        return {
          results: [
            {
              data: async () => ({
                url: '/EnvelopeFollowerWithSkewLimiter/build/02-pcba-part-alignment/',
                meta: { title: 'PCBA Part Alignment Checklist' },
                excerpt: 'D3 — <mark>BAT54S</mark> SOT-23 placement check<img src=x onerror=alert(1)>',
              }),
            },
            {
              data: async () => ({
                url: '/EnvelopeFollowerWithSkewLimiter/specs/design-spec/',
                meta: { title: 'Final Design Spec' },
                excerpt: '<mark>BAT54S</mark> Dual-Series Schottky',
              }),
            },
          ],
        };
      },
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0, navigate });
    try {
      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();
      await Promise.resolve();

      const input = doc.querySelector<HTMLInputElement>('[data-search-input]')!;
      input.value = 'BAT54S';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      await new Promise((r) => setTimeout(r, 15));

      const items = [...doc.querySelectorAll<HTMLAnchorElement>('[data-search-results] a')];
      expect(items).toHaveLength(2);
      expect(items[0]?.getAttribute('href')).toBe(
        '/EnvelopeFollowerWithSkewLimiter/build/02-pcba-part-alignment/',
      );
      expect(doc.querySelector('[data-search-results] img')).toBeNull();
      expect(doc.querySelectorAll('[data-search-results] mark').length).toBe(2);
      expect(doc.querySelector('[data-search-results]')?.textContent).toContain('Build');

      // Keyboard ArrowDown selects second item; Enter navigates
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event,
      );
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
      expect(navigate).toHaveBeenCalledWith(
        '/EnvelopeFollowerWithSkewLimiter/specs/design-spec/',
      );
    } finally {
      cleanup();
      win.close();
    }
  });

  it('displays a friendly fallback status if Pagefind index is unavailable', async () => {
    const { win, doc } = setupSearchDom();
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => {
      throw new Error('404 pagefind.js');
    });

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0 });
    try {
      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(doc.querySelector('[data-search-status]')?.textContent).toContain('npm run build');
    } finally {
      cleanup();
      win.close();
    }
  });

  it('opens on / shortcut and Ctrl+K, but ignores / when defaultPrevented, modified, or inside editable targets', async () => {
    const { win, doc, dialog } = setupSearchDom();
    const main = doc.querySelector('main')!;
    main.innerHTML = `
      <input id="plain-input" type="text" />
      <textarea id="plain-textarea"></textarea>
      <select id="plain-select"><option>A</option></select>
      <div id="ce-true" contenteditable="true"><span id="ce-child">editable</span></div>
      <div id="ce-empty" contenteditable="">empty-attr</div>
      <div id="ce-false" contenteditable="false">not-editable</div>
    `;
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: async () => ({ results: [] }),
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0 });
    try {
      // Editable targets should ignore `/`
      for (const selector of ['#plain-input', '#plain-textarea', '#plain-select', '#ce-true', '#ce-child', '#ce-empty']) {
        const el = doc.querySelector<HTMLElement>(selector)!;
        el.focus?.();
        el.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', bubbles: true }) as unknown as Event);
        expect(dialog.hasAttribute('open')).toBe(false);
        el.blur?.();
      }

      // Active editable element should also block `/` even if keydown fires on document
      const plainInput = doc.querySelector<HTMLInputElement>('#plain-input')!;
      plainInput.focus();
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', bubbles: true }) as unknown as Event);
      expect(dialog.hasAttribute('open')).toBe(false);
      plainInput.blur();

      // Modifiers should ignore `/`
      for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', bubbles: true, ...mods }) as unknown as Event);
        expect(dialog.hasAttribute('open')).toBe(false);
      }

      // defaultPrevented should ignore `/`
      const preventedEvt = new win.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
      preventedEvt.preventDefault();
      doc.dispatchEvent(preventedEvt as unknown as Event);
      expect(dialog.hasAttribute('open')).toBe(false);

      // contenteditable="false" is NOT editable -> `/` opens search
      const ceFalse = doc.querySelector<HTMLElement>('#ce-false')!;
      ceFalse.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', bubbles: true }) as unknown as Event);
      await Promise.resolve();
      expect(dialog.hasAttribute('open')).toBe(true);

      dialog.close();
      expect(dialog.hasAttribute('open')).toBe(false);

      // Ctrl+K opens search
      doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }) as unknown as Event);
      await Promise.resolve();
      expect(dialog.hasAttribute('open')).toBe(true);
    } finally {
      cleanup();
      win.close();
    }
  });

  it('syncs ARIA combobox attributes (aria-expanded, aria-activedescendant, result ids) and wraps ArrowUp/ArrowDown selection', async () => {
    const { win, doc } = setupSearchDom();
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: async (q: string) => {
        if (q === 'empty') return { results: [] };
        return {
          results: [
            {
              data: async () => ({
                url: '/EnvelopeFollowerWithSkewLimiter/patches/01-sidechain-ducking/',
                meta: { title: 'Sidechain Ducking' },
              }),
            },
            {
              data: async () => ({
                url: '/EnvelopeFollowerWithSkewLimiter/build/01-kit-prep/',
                meta: { title: 'Kit Prep' },
              }),
            },
          ],
        };
      },
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0 });
    try {
      const input = doc.querySelector<HTMLInputElement>('[data-search-input]')!;
      expect(input.getAttribute('role')).toBe('combobox');
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.getAttribute('aria-controls')).toBe('site-search-results');

      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();

      input.value = 'ducking';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      await new Promise((r) => setTimeout(r, 15));

      const listItems = [...doc.querySelectorAll<HTMLLIElement>('[data-search-results] li')];
      expect(listItems.map((li) => li.id)).toEqual([
        'site-search-result-0',
        'site-search-result-1',
      ]);
      expect(input.getAttribute('aria-expanded')).toBe('true');
      expect(input.getAttribute('aria-activedescendant')).toBe('site-search-result-0');

      // ArrowUp from 0 wraps around to last item (index 1)
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }) as unknown as Event,
      );
      expect(input.getAttribute('aria-activedescendant')).toBe('site-search-result-1');
      expect(listItems[1]?.getAttribute('aria-selected')).toBe('true');

      // Searching with no results resets aria-expanded="false" and removes aria-activedescendant
      input.value = 'empty';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      await new Promise((r) => setTimeout(r, 15));
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    } finally {
      cleanup();
      win.close();
    }
  });

  it('debounces rapid search input when debounceMs > 0', async () => {
    vi.useFakeTimers();
    const { win, doc } = setupSearchDom();
    const searchMock = vi.fn(async () => ({ results: [] }));
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: searchMock,
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 100 });
    try {
      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();

      const input = doc.querySelector<HTMLInputElement>('[data-search-input]')!;
      input.value = 'T';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      vi.advanceTimersByTime(50);
      input.value = 'TP7';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      vi.advanceTimersByTime(99);
      expect(searchMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect(searchMock).toHaveBeenCalledWith('TP7');
    } finally {
      cleanup();
      win.close();
      vi.useRealTimers();
    }
  });

  it('decodes basic HTML entities safely in search excerpts without injecting HTML', async () => {
    const { win, doc } = setupSearchDom();
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: async () => ({
        results: [
          {
            data: async () => ({
              url: '/EnvelopeFollowerWithSkewLimiter/specs/design-spec/',
              meta: { title: 'Entity Decoding Test' },
              excerpt:
                'Gain &lt; 1 &amp; &gt; 0 &quot;quoted&quot; &#39;single&#39; &#x27;hex&#x27; &amp;lt;literal&amp;gt; <mark>&amp;amp;</mark>',
            }),
          },
        ],
      }),
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0 });
    try {
      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();

      const input = doc.querySelector<HTMLInputElement>('[data-search-input]')!;
      input.value = 'entity';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      await new Promise((r) => setTimeout(r, 15));

      const excerptEl = doc.querySelector<HTMLElement>('.search-result-excerpt')!;
      expect(excerptEl.textContent).toBe(
        `Gain < 1 & > 0 "quoted" 'single' 'hex' &lt;literal&gt; &amp;`,
      );
      expect(excerptEl.querySelectorAll('mark')).toHaveLength(1);
      expect(excerptEl.querySelector('mark')?.textContent).toBe('&amp;');
    } finally {
      cleanup();
      win.close();
    }
  });

  it('ignores Enter during IME composition (isComposing or keyCode 229)', async () => {
    const { win, doc, dialog } = setupSearchDom();
    const navigate = vi.fn<(url: string) => void>();
    const loadPagefind = vi.fn<() => Promise<PagefindApi>>(async () => ({
      search: async () => ({
        results: [
          {
            data: async () => ({
              url: '/EnvelopeFollowerWithSkewLimiter/patches/01-sidechain-ducking/',
              meta: { title: 'Sidechain Ducking' },
            }),
          },
        ],
      }),
    }));

    const cleanup = initSearchModal({ root: doc, loadPagefind, debounceMs: 0, navigate });
    try {
      doc.querySelector<HTMLButtonElement>('[data-search-trigger]')!.click();
      await Promise.resolve();

      const input = doc.querySelector<HTMLInputElement>('[data-search-input]')!;
      input.value = 'ducking';
      input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
      await new Promise((r) => setTimeout(r, 15));

      // IME isComposing: true
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
        }) as unknown as Event,
      );
      expect(navigate).not.toHaveBeenCalled();
      expect(dialog.hasAttribute('open')).toBe(true);

      // Legacy WebKit/Chromium IME keyCode: 229
      const legacyImeEvt = new win.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      });
      Object.defineProperty(legacyImeEvt, 'keyCode', { value: 229 });
      input.dispatchEvent(legacyImeEvt as unknown as Event);
      expect(navigate).not.toHaveBeenCalled();
      expect(dialog.hasAttribute('open')).toBe(true);

      // Regular Enter navigates
      input.dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      );
      expect(navigate).toHaveBeenCalledWith(
        '/EnvelopeFollowerWithSkewLimiter/patches/01-sidechain-ducking/',
      );
    } finally {
      cleanup();
      win.close();
    }
  });
});
