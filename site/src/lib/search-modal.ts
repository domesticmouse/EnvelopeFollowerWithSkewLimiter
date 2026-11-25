import { showModalSafe, wireBackdropLightDismiss } from './dialog-chrome.ts';
import { SITE_BASE } from './routes.ts';

/** Pagefind search result payload returned by result.data(). */
export interface PagefindSearchResultData {
  url: string;
  meta?: {
    title?: string;
  };
  excerpt?: string;
}

/** Lazy result handle yielded by pagefind.search(). */
export interface PagefindSearchResult {
  id?: string;
  data: () => Promise<PagefindSearchResultData>;
}

/** Minimal Pagefind runtime interface. */
export interface PagefindApi {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindSearchResult[] }>;
}

/** Section classification badge rendered next to each search hit. */
export interface SearchSectionInfo {
  key: 'patches' | 'build' | 'hardware' | 'specs' | 'origin' | 'downloads' | 'overview';
  label: string;
}

/** Dependency injection hooks for unit testing without network/bundle side effects. */
export interface SearchModalOptions {
  root?: Document;
  loadPagefind?: () => Promise<PagefindApi>;
  debounceMs?: number;
  navigate?: (url: string) => void;
}

/** Classify a built route URL into its top-level documentation section badge. */
export function classifyRouteSection(url: string): SearchSectionInfo {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/i, '');
  const withoutHash = withoutOrigin.split('#')[0] ?? withoutOrigin;
  const rel = withoutHash.startsWith(SITE_BASE)
    ? withoutHash.slice(SITE_BASE.length) || '/'
    : withoutHash || '/';

  if (rel.startsWith('/patches')) {
    return { key: 'patches', label: 'Patches' };
  }
  if (rel.startsWith('/build')) {
    return { key: 'build', label: 'Build' };
  }
  if (rel.startsWith('/hardware')) {
    return { key: 'hardware', label: 'Hardware' };
  }
  if (rel.startsWith('/specs')) {
    return { key: 'specs', label: 'Reference Specs' };
  }
  if (rel.startsWith('/origin')) {
    return { key: 'origin', label: 'Origin' };
  }
  if (rel.startsWith('/downloads')) {
    return { key: 'downloads', label: 'Downloads' };
  }
  return { key: 'overview', label: 'Overview' };
}

/** Return true when a keydown target or active element is a text-editing control. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }
  const element = target as Partial<HTMLElement>;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (element.isContentEditable) {
    return true;
  }
  if (typeof element.getAttribute === 'function') {
    const attr = element.getAttribute('contenteditable');
    if (attr !== null && attr.toLowerCase() !== 'false') {
      return true;
    }
  }
  if (typeof element.closest === 'function') {
    return (
      element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
    );
  }
  return false;
}

async function defaultLoadPagefind(): Promise<PagefindApi> {
  const moduleUrl = `${SITE_BASE}/pagefind/pagefind.js`;
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as PagefindApi;
  if (typeof mod.init === 'function') {
    await mod.init();
  }
  return mod;
}

/** Decode basic HTML character references in Pagefind excerpts (decoding `&amp;` last). */
export function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * Populate an element with Pagefind excerpt text, preserving ONLY `<mark>` highlight spans
 * cleanly as DOM nodes (never inserting untrusted HTML).
 */
function appendSafeExcerpt(target: HTMLElement, rawExcerpt: string): void {
  const stripped = rawExcerpt.replace(/<(?!\/?mark\b)[^>]*>/gi, '');
  const tokens = stripped.split(/(<\/?mark\b[^>]*>)/gi);
  let insideMark = false;

  for (const token of tokens) {
    if (!token) continue;
    if (/^<mark\b/i.test(token)) {
      insideMark = true;
      continue;
    }
    if (/^<\/mark>/i.test(token)) {
      insideMark = false;
      continue;
    }
    const decoded = decodeBasicEntities(token);
    if (insideMark) {
      const mark = target.ownerDocument.createElement('mark');
      mark.textContent = decoded;
      target.appendChild(mark);
    } else {
      target.appendChild(target.ownerDocument.createTextNode(decoded));
    }
  }
}

/**
 * Hydrates the global native `<dialog closedby="any">` site search palette (`⌘K` / header Search).
 * Lazy-imports Pagefind strictly on first modal open.
 */
export function initSearchModal(options: SearchModalOptions = {}): () => void {
  const root = options.root ?? document;
  const dialog = root.querySelector<HTMLDialogElement>('[data-search-dialog]');
  if (!dialog) {
    return () => {};
  }

  const input = dialog.querySelector<HTMLInputElement>('[data-search-input]');
  const resultsEl = dialog.querySelector<HTMLElement>('[data-search-results]');
  const statusEl = dialog.querySelector<HTMLElement>('[data-search-status]');
  const closeBtn = dialog.querySelector<HTMLButtonElement>('[data-search-close]');
  if (!input || !resultsEl || !statusEl) {
    return () => {};
  }

  const controller = new AbortController();
  const { signal } = controller;
  const debounceMs = options.debounceMs ?? 120;
  const navigate =
    options.navigate ??
    ((url: string) => {
      if (typeof window !== 'undefined') {
        window.location.assign(url);
      }
    });

  let pagefindPromise: Promise<PagefindApi> | null = null;
  let activeTrigger: HTMLElement | null = null;
  let debounceTimer: number | undefined;
  let activeIndex = -1;
  let latestQueryToken = 0;

  const loadIndex = (): Promise<PagefindApi> => {
    if (!pagefindPromise) {
      pagefindPromise = (options.loadPagefind ?? defaultLoadPagefind)().catch((err) => {
        pagefindPromise = null;
        throw err;
      });
    }
    return pagefindPromise;
  };

  const updateSelection = (nextIdx: number): void => {
    const items = [...resultsEl.querySelectorAll<HTMLElement>('[data-search-result]')];
    if (items.length === 0) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    const clamped = ((nextIdx % items.length) + items.length) % items.length;
    activeIndex = clamped;
    items.forEach((item, idx) => {
      const selected = idx === clamped;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.toggleAttribute('data-selected', selected);
    });
    const activeItem = items[clamped];
    if (activeItem) {
      if (activeItem.id) {
        input.setAttribute('aria-activedescendant', activeItem.id);
      }
      input.setAttribute('aria-expanded', 'true');
      if (typeof activeItem.scrollIntoView === 'function') {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const executeSearch = async (query: string): Promise<void> => {
    const token = ++latestQueryToken;
    const trimmed = query.trim();
    resultsEl.textContent = '';
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');

    if (!trimmed) {
      statusEl.textContent = 'Type to search specs, patches, checklist steps, or components (TP7, BAT54S, A-1076).';
      return;
    }

    statusEl.textContent = `Searching "${trimmed}"…`;
    let api: PagefindApi;
    try {
      api = await loadIndex();
    } catch {
      if (token !== latestQueryToken) return;
      statusEl.textContent = 'Search index is generated by static build (npm run build) and is unavailable in dev mode.';
      return;
    }

    const response = await api.search(trimmed);
    if (token !== latestQueryToken) return;

    const hydrated = await Promise.all(response.results.slice(0, 12).map((hit) => hit.data()));
    if (token !== latestQueryToken) return;

    resultsEl.textContent = '';
    if (hydrated.length === 0) {
      statusEl.textContent = `No results found for "${trimmed}".`;
      return;
    }

    statusEl.textContent = `${hydrated.length} matching page${hydrated.length === 1 ? '' : 's'} for "${trimmed}"`;
    for (const [idx, hit] of hydrated.entries()) {
      const li = root.createElement('li');
      li.id = `site-search-result-${idx}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.setAttribute('data-search-result', 'true');
      li.className = 'search-result-item';

      const link = root.createElement('a');
      link.href = hit.url;
      link.className = 'search-result-link';

      const topRow = root.createElement('div');
      topRow.className = 'search-result-top';

      const badge = root.createElement('span');
      const section = classifyRouteSection(hit.url);
      badge.className = `search-result-badge search-badge-${section.key}`;
      badge.textContent = section.label;

      const titleSpan = root.createElement('span');
      titleSpan.className = 'search-result-title';
      titleSpan.textContent = hit.meta?.title || hit.url;

      topRow.append(badge, titleSpan);
      link.appendChild(topRow);

      if (hit.excerpt) {
        const excerptP = root.createElement('p');
        excerptP.className = 'search-result-excerpt';
        appendSafeExcerpt(excerptP, hit.excerpt);
        link.appendChild(excerptP);
      }

      li.appendChild(link);
      resultsEl.appendChild(li);
    }
    updateSelection(0);
  };

  const openSearch = (trigger?: HTMLElement | null): void => {
    if (dialog.open || dialog.hasAttribute('open')) {
      input.focus();
      return;
    }
    const focused = trigger ?? (root.activeElement as HTMLElement | null);
    activeTrigger = focused && typeof focused.focus === 'function' ? focused : null;

    showModalSafe(dialog);
    input.focus();

    void loadIndex().then(
      () => {
        if (!input.value.trim()) {
          statusEl.textContent =
            'Index ready — search components (BAT54S, A-1076, TP7), patch setups, or spec formulas.';
        }
      },
      () => {
        statusEl.textContent =
          'Search index is generated by static build (npm run build) and is unavailable in dev mode.';
      },
    );
  };

  wireBackdropLightDismiss(dialog, signal);

  dialog.addEventListener(
    'close',
    () => {
      dialog.returnValue = '';
      if (activeTrigger && activeTrigger.isConnected) {
        activeTrigger.focus();
      }
      activeTrigger = null;
    },
    { signal },
  );

  closeBtn?.addEventListener('click', () => dialog.close(), { signal });

  for (const trigger of root.querySelectorAll<HTMLElement>('[data-search-trigger]')) {
    trigger.addEventListener('click', () => openSearch(trigger), { signal });
  }

  root.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
        return;
      }
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableTarget(event.target) &&
        !isEditableTarget(root.activeElement)
      ) {
        event.preventDefault();
        openSearch();
      }
    },
    { signal },
  );

  input.addEventListener(
    'input',
    () => {
      const value = input.value;
      if (debounceTimer !== undefined) {
        globalThis.clearTimeout(debounceTimer);
      }
      if (debounceMs <= 0) {
        void executeSearch(value);
        return;
      }
      debounceTimer = globalThis.setTimeout(() => {
        void executeSearch(value);
      }, debounceMs) as unknown as number;
    },
    { signal },
  );

  input.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateSelection(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateSelection(activeIndex - 1);
      } else if (event.key === 'Enter') {
        if (event.isComposing || event.keyCode === 229) {
          return;
        }
        if (activeIndex >= 0) {
          const selectedLink = resultsEl.querySelectorAll<HTMLAnchorElement>('[data-search-result] a')[
            activeIndex
          ];
          if (selectedLink) {
            event.preventDefault();
            const href = selectedLink.getAttribute('href') ?? selectedLink.href;
            dialog.close();
            navigate(href);
          }
        }
      }
    },
    { signal },
  );

  return () => {
    if (debounceTimer !== undefined) {
      globalThis.clearTimeout(debounceTimer);
    }
    controller.abort();
  };
}
