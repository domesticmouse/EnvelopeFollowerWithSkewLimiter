import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { VFile } from 'vfile';
import { describe, expect, it, vi } from 'vitest';
import { BUILD_CHECKLISTS_CATALOG, TOTAL_CHECKLIST_ITEMS } from '../src/data/build-checklists.ts';
import {
  initBuildHubPage,
  initChecklistDetailPage,
} from '../src/lib/checklist-controller.ts';
import { generateChecklistItemId } from '../src/lib/checklist-id.ts';
import {
  CHECKLIST_STORAGE_PREFIX,
  clearChecklistProgress,
  computeAllChecklistsProgress,
  getChecklistStorageKey,
  loadCheckedItemIds,
  saveCheckedItemIds,
} from '../src/lib/checklist-storage.ts';
import { rehypeSingleSource } from '../src/plugins/rehype-single-source.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

async function renderChecklistFragment(sourceRepoPath: string): Promise<string> {
  const fullPath = path.join(REPO_ROOT, sourceRepoPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSingleSource, { repoRoot: REPO_ROOT, sourceRepoPath })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const result = await processor.process(new VFile({ value: raw, path: fullPath }));
  return String(result.value);
}

function buildDetailDomFixture(slug: string, proseHtml: string): {
  win: Window;
  doc: Document;
} {
  const win = new Window();
  const railHtml = BUILD_CHECKLISTS_CATALOG.map(
    (step) =>
      `<a href="/build/${step.slug}/">${step.shortTitle}<span class="rail-progress" data-rail-slug="${step.slug}">0 / ${step.totalItems}</span></a>`,
  ).join('');

  win.document.body.innerHTML = `
    <div data-checklist-page="${slug}">
      <nav>${railHtml}</nav>
      <div class="checklist-toolbar">
        <span data-checklist-summary>0 / 0</span>
        <div class="checklist-meter"><div data-checklist-meter-bar style="width: 0%"></div></div>
        <label><input type="checkbox" data-hide-completed /> Hide completed</label>
        <button type="button" data-reset-open>Reset Progress</button>
      </div>
      <div class="doc-prose">${proseHtml}</div>
      <div aria-live="polite" class="sr-only" data-checklist-live></div>
      <dialog data-reset-dialog closedby="any">
        <form method="dialog">
          <h2>Reset checklist progress?</h2>
          <p>This clears saved checkboxes for this phase in this browser.</p>
          <button type="submit" value="cancel" data-reset-cancel autofocus>Cancel</button>
          <button type="submit" value="confirm" data-reset-confirm>Reset step</button>
        </form>
      </dialog>
    </div>
  `;

  const doc = win.document as unknown as Document;
  const dialog = doc.querySelector<HTMLDialogElement>('[data-reset-dialog]')!;
  dialog.showModal = () => {
    dialog.setAttribute('open', '');
  };
  dialog.close = (returnValue?: string) => {
    if (returnValue !== undefined) {
      dialog.returnValue = returnValue;
    }
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new win.Event('close') as unknown as Event);
  };

  return { win, doc };
}

describe('checklist-id and checklist-storage', () => {
  it('generates deterministic, collision-safe IDs tied to section and item text rather than index', () => {
    const a1 = generateChecklistItemId(
      '01-main-board-ordering',
      '1-pre-order-export--sanity-checks',
      'Run KiCad DRC cleanly',
    );
    const a2 = generateChecklistItemId(
      '01-main-board-ordering',
      '1-pre-order-export--sanity-checks',
      'Run KiCad DRC cleanly',
    );
    expect(a1).toBe(a2);
    expect(a1.startsWith('chk-')).toBe(true);

    const dupTracker = new Map<string, number>();
    const first = generateChecklistItemId('02-pcba-part-alignment', 'section-a', 'Same text', dupTracker);
    const second = generateChecklistItemId('02-pcba-part-alignment', 'section-a', 'Same text', dupTracker);
    expect(first).not.toBe(second);
    expect(second.endsWith('-2')).toBe(true);
  });

  it('persists checked IDs under versioned storage keys and recovers from corrupt or old payloads', () => {
    const storage = createMemoryStorage({
      [getChecklistStorageKey('01-main-board-ordering')]: '{not valid json',
      [getChecklistStorageKey('01b-front-panel-ordering')]: JSON.stringify({
        version: 99,
        checked: ['stale'],
      }),
    });

    expect(getChecklistStorageKey('01-main-board-ordering')).toBe(
      `${CHECKLIST_STORAGE_PREFIX}01-main-board-ordering`,
    );
    expect(loadCheckedItemIds('01-main-board-ordering', storage).size).toBe(0);
    expect(loadCheckedItemIds('01b-front-panel-ordering', storage).size).toBe(0);

    saveCheckedItemIds('01-main-board-ordering', ['chk-b', 'chk-a', 'chk-b'], storage);
    const loaded = loadCheckedItemIds('01-main-board-ordering', storage);
    expect([...loaded]).toEqual(['chk-a', 'chk-b']);

    clearChecklistProgress('01-main-board-ordering', storage);
    expect(loadCheckedItemIds('01-main-board-ordering', storage).size).toBe(0);
  });
});

describe('checklist-controller and /build/ aggregate tracker', () => {
  it('restores state, toggles parent and nested items independently, supports Hide completed, and safely resets via dialog', async () => {
    const html = await renderChecklistFragment('checklists/04-hand-assembly.md');
    const storage = createMemoryStorage();
    const { win, doc } = buildDetailDomFixture('04-hand-assembly', html);
    const cleanup = initChecklistDetailPage({ root: doc, storage });

    try {
      const checkboxes = [...doc.querySelectorAll<HTMLInputElement>('[data-checklist-checkbox]')];
      expect(checkboxes).toHaveLength(41);
      expect(checkboxes.every((cb) => !cb.checked && !cb.disabled)).toBe(true);

      // Verify nested sub-items exist inside an outer parent <li>
      const parentLi = [...doc.querySelectorAll<HTMLElement>('li[data-checklist-item]')].find(
        (li) => li.querySelectorAll('li[data-checklist-item]').length > 0,
      );
      expect(parentLi).toBeDefined();
      const parentCb = parentLi!.querySelector<HTMLInputElement>(':scope > label [data-checklist-checkbox]')!;
      const childCbs = [...parentLi!.querySelectorAll<HTMLInputElement>('ul li [data-checklist-checkbox]')];
      expect(childCbs.length).toBeGreaterThan(0);

      // Toggling parent must NOT auto-check children; toggling child must NOT auto-check parent
      parentCb.checked = true;
      parentCb.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      expect(childCbs.every((cb) => !cb.checked)).toBe(true);
      expect(loadCheckedItemIds('04-hand-assembly', storage).size).toBe(1);

      // Parent stays visible under Hide completed while an unchecked child remains
      const hideToggle = doc.querySelector<HTMLInputElement>('[data-hide-completed]')!;
      hideToggle.checked = true;
      hideToggle.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      expect(parentLi!.hasAttribute('data-hidden-completed')).toBe(false);

      // Leaf item hides cleanly when checked while Hide completed is on
      const leafCb = checkboxes.find(
        (cb) => !cb.closest('li[data-checklist-item]')?.querySelector('li[data-checklist-item]'),
      )!;
      leafCb.checked = true;
      leafCb.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      expect(leafCb.closest('li[data-checklist-item]')?.getAttribute('data-hidden-completed')).toBe(
        'true',
      );
      expect(doc.querySelector('[data-checklist-summary]')?.textContent).toContain('2 / 41');
      expect(doc.querySelector('[data-rail-slug="04-hand-assembly"]')?.textContent).toBe('2 / 41');

      // Reset dialog puts autofocus on Cancel and ignores cancel dismissal
      const resetDialog = doc.querySelector<HTMLDialogElement>('[data-reset-dialog]')!;
      const cancelBtn = resetDialog.querySelector<HTMLButtonElement>('[data-reset-cancel]')!;
      expect(cancelBtn.hasAttribute('autofocus')).toBe(true);

      doc.querySelector<HTMLButtonElement>('[data-reset-open]')!.click();
      expect(resetDialog.hasAttribute('open')).toBe(true);
      resetDialog.close('cancel');
      expect(loadCheckedItemIds('04-hand-assembly', storage).size).toBe(2);

      // Confirm resets both storage and DOM
      doc.querySelector<HTMLButtonElement>('[data-reset-open]')!.click();
      resetDialog.close('confirm');
      expect(loadCheckedItemIds('04-hand-assembly', storage).size).toBe(0);
      expect(checkboxes.every((cb) => !cb.checked)).toBe(true);
      expect(doc.querySelector('[data-checklist-summary]')?.textContent).toContain('0 / 41');
    } finally {
      cleanup();
      win.close();
    }
  });

  it('collapses placement-card photos when checked on 02/04 with inline Show photo reveal and opens fullscreen lightbox', async () => {
    const html = await renderChecklistFragment('checklists/02-pcba-part-alignment.md');
    const storage = createMemoryStorage();
    const { win, doc } = buildDetailDomFixture('02-pcba-part-alignment', html);
    const opened: Array<{ count: number; startIndex: number }> = [];
    const cleanup = initChecklistDetailPage({
      root: doc,
      storage,
      onOpenLightbox: (items, startIndex) => opened.push({ count: items.length, startIndex }),
    });

    try {
      const card = doc.querySelector<HTMLElement>('[data-placement-card]')!;
      expect(card).not.toBeNull();
      const parentItem = card.closest<HTMLElement>('li[data-checklist-item]')!;
      const cb = parentItem.querySelector<HTMLInputElement>(':scope > label [data-checklist-checkbox]')!;

      // Clicking placement image triggers lightbox gallery callback
      const imgBtn = card.querySelector<HTMLButtonElement>('[data-lightbox-src]')!;
      imgBtn.click();
      expect(opened).toHaveLength(1);
      expect(opened[0]!.count).toBe(51);

      // Checking item collapses placement card and reveals inline Show photo button
      cb.checked = true;
      cb.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event);
      expect(card.classList.contains('is-collapsed')).toBe(true);

      const revealBtn = card.querySelector<HTMLButtonElement>('[data-placement-reveal]')!;
      expect(revealBtn.hidden).toBe(false);
      revealBtn.click();
      expect(card.classList.contains('is-expanded-override')).toBe(true);
    } finally {
      cleanup();
      win.close();
    }
  });

  it('copies CLI commands / PCB remarks via clipboard handler and updates button status', async () => {
    const html = await renderChecklistFragment('checklists/01b-front-panel-ordering.md');
    const storage = createMemoryStorage();
    const { win, doc } = buildDetailDomFixture('01b-front-panel-ordering', html);
    const copyText = vi.fn<(text: string) => Promise<void>>(async () => {});
    const cleanup = initChecklistDetailPage({ root: doc, storage, copyText });

    try {
      const copyBtn = doc.querySelector<HTMLButtonElement>('[data-copy-trigger]')!;
      expect(copyBtn).not.toBeNull();
      copyBtn.click();
      await Promise.resolve();

      expect(copyText).toHaveBeenCalledTimes(1);
      expect(copyText.mock.calls[0]![0]).toContain('kicad-cli pcb drc');
      expect(copyBtn.textContent).toContain('Copied');
    } finally {
      cleanup();
      win.close();
    }
  });

  it('aggregates X / 211 progress across all 6 steps on the /build/ hub page and resets cleanly', () => {
    const storage = createMemoryStorage();
    saveCheckedItemIds('01-main-board-ordering', ['a', 'b', 'c'], storage);
    saveCheckedItemIds('03-tayda-ordering', ['t1', 't2'], storage);

    expect(TOTAL_CHECKLIST_ITEMS).toBe(211);
    const summary = computeAllChecklistsProgress(storage);
    expect(summary.totalDone).toBe(5);
    expect(summary.totalItems).toBe(211);

    const win = new Window();
    const cardsHtml = BUILD_CHECKLISTS_CATALOG.map(
      (step) => `
        <article data-hub-step="${step.slug}">
          <span data-hub-step-count="${step.slug}">0 / ${step.totalItems}</span>
          <span data-hub-step-status="${step.slug}">Not started</span>
          <div data-hub-step-bar="${step.slug}" style="width: 0%"></div>
        </article>
      `,
    ).join('');

    win.document.body.innerHTML = `
      <div data-build-hub>
        <strong data-hub-total>0 / 211</strong>
        <div data-hub-total-bar style="width: 0%"></div>
        <button type="button" data-hub-reset-open>Reset all</button>
        ${cardsHtml}
        <dialog data-hub-reset-dialog closedby="any">
          <form method="dialog">
            <button type="submit" value="cancel" data-reset-cancel autofocus>Cancel</button>
            <button type="submit" value="confirm" data-reset-confirm>Reset all phases</button>
          </form>
        </dialog>
      </div>
    `;

    const doc = win.document as unknown as Document;
    const dialog = doc.querySelector<HTMLDialogElement>('[data-hub-reset-dialog]')!;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = (rv?: string) => {
      if (rv !== undefined) dialog.returnValue = rv;
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new win.Event('close') as unknown as Event);
    };

    const cleanup = initBuildHubPage({
      root: doc,
      storage,
    });

    try {
      expect(doc.querySelector('[data-hub-total]')?.textContent).toBe('5 / 211');
      expect(
        doc.querySelector('[data-hub-step-count="01-main-board-ordering"]')?.textContent,
      ).toBe('3 / 42');
      expect(
        doc.querySelector('[data-hub-step-status="03-tayda-ordering"]')?.textContent,
      ).toBe('In progress');

      doc.querySelector<HTMLButtonElement>('[data-hub-reset-open]')!.click();
      dialog.close('confirm');
      expect(doc.querySelector('[data-hub-total]')?.textContent).toBe('0 / 211');
    } finally {
      cleanup();
      win.close();
    }
  });
});
