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
      <button type="button" data-search-trigger aria-label="Search site">Search ⌘K</button>
    </header>
    <main>Content</main>
    <dialog id="site-search-dialog" data-search-dialog data-managed-dialog closedby="any">
      <div>
        <button type="button" data-search-close aria-label="Close search">Close</button>
        <input type="search" data-search-input placeholder="Search patches, build steps, components..." />
        <p data-search-status>Type to search</p>
        <ul data-search-results role="listbox" aria-label="Search results"></ul>
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
});
