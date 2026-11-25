import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Parent, Properties, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { generateChecklistItemId } from '../lib/checklist-id.ts';
import { resolveRelativeRepoPath, resolveRepoHref } from '../lib/content-manifest.ts';
import { readImageDimensions } from '../lib/image-dimensions.ts';
import type { PanelControlId } from '../lib/panel-svg-shared.ts';
import { SITE_BASE, withBase } from '../lib/routes.ts';
import { toPosixPath } from '../lib/static-passthrough.ts';

/** Configuration for the single-source Markdown rehype transform module. */
export interface SingleSourceRehypeOptions {
  repoRoot: string;
  sourceRepoPath?: string;
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveSourceRepoPath(
  repoRoot: string,
  file: VFile,
  explicitSourcePath?: string,
): string {
  if (explicitSourcePath) {
    return toPosixPath(explicitSourcePath);
  }

  const rawCandidate = file.path || file.history[0] || '';
  if (!rawCandidate) {
    return '';
  }

  const absCandidate = rawCandidate.startsWith('file://')
    ? fileURLToPath(rawCandidate)
    : path.resolve(rawCandidate);
  const absRoot = path.resolve(repoRoot);

  let rel = path.relative(absRoot, absCandidate);
  if (rel.startsWith('..')) {
    try {
      rel = path.relative(fs.realpathSync(absRoot), fs.realpathSync(absCandidate));
    } catch {
      // Keep original relative computation if realpath fails
    }
  }
  return toPosixPath(rel);
}

function getClasses(el: Element): string[] {
  const raw: unknown = el.properties?.className;
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  if (typeof raw === 'string') {
    return raw.split(/\s+/).filter(Boolean);
  }
  return [];
}

function hasClass(el: Element, className: string): boolean {
  return getClasses(el).includes(className);
}

function addClass(el: Element, ...classesToAdd: string[]): void {
  el.properties ??= {};
  const merged = new Set(getClasses(el));
  for (const cls of classesToAdd) {
    if (cls) {
      merged.add(cls);
    }
  }
  el.properties.className = [...merged];
}

function extractText(node: Root | RootContent, skipMathml: boolean): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (
    skipMathml &&
    node.type === 'element' &&
    (hasClass(node, 'katex-mathml') || node.tagName === 'math')
  ) {
    return '';
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((child) => extractText(child, skipMathml)).join('');
  }
  return '';
}

function h(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return {
    type: 'element',
    tagName,
    properties,
    children,
  };
}

function findDescendants(root: Element, predicate: (el: Element) => boolean): Element[] {
  const matches: Element[] = [];
  for (const child of root.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (predicate(child)) {
      matches.push(child);
    }
    matches.push(...findDescendants(child, predicate));
  }
  return matches;
}

function hasNestedTable(tableEl: Element): boolean {
  return tableEl.children.some(
    (child) =>
      child.type === 'element' && findDescendants(child, (el) => el.tagName === 'table').length > 0,
  );
}

function containsKatexDisplay(node: Element): boolean {
  if (hasClass(node, 'katex-display')) {
    return true;
  }
  return node.children.some((child) => child.type === 'element' && containsKatexDisplay(child));
}

function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replace(/\s+/g, ' ').trim();
}

function getPreCodeInfo(
  node: Element,
): { lang: string | undefined; codeChild: Element | undefined } | null {
  if (node.tagName !== 'pre') {
    return null;
  }
  const codeChild = node.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code',
  );
  const dataLang =
    typeof node.properties?.dataLanguage === 'string' ? node.properties.dataLanguage : undefined;
  const classLang = codeChild
    ? getClasses(codeChild)
        .find((cls) => cls.startsWith('language-'))
        ?.slice('language-'.length)
    : undefined;
  const lang = dataLang ?? classLang ?? (hasClass(node, 'mermaid') ? 'mermaid' : undefined);
  return { lang, codeChild };
}

function assignHeadingIds(tree: Root): void {
  const slugger = new GithubSlugger();
  visit(tree, 'element', (node) => {
    if (!HEADING_TAGS.has(node.tagName)) {
      return;
    }
    const text = extractText(node, true).trim();
    if (!text) {
      return;
    }
    node.properties ??= {};
    node.properties.id = slugger.slug(text);
  });
}

function rewriteLinksAndImages(
  tree: Root,
  sourceRepoPath: string,
  repoRoot: string,
): void {
  visit(tree, 'element', (node) => {
    if (node.tagName === 'a') {
      const href = node.properties?.href;
      if (typeof href === 'string') {
        const resolved = resolveRepoHref(href, sourceRepoPath);
        node.properties ??= {};
        node.properties.href = resolved;
        if (resolved.endsWith('/bom/ibom.html') || resolved.endsWith('bom/ibom.html')) {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
          node.properties.dataIbomLink = true;
        }
      }
      return;
    }

    if (node.tagName === 'img') {
      const src = node.properties?.src;
      if (typeof src !== 'string' || !src.trim()) {
        return;
      }
      node.properties ??= {};

      const trimmedSrc = src.trim();
      if (!EXTERNAL_URL_RE.test(trimmedSrc)) {
        const repoRelPath =
          trimmedSrc === SITE_BASE || trimmedSrc.startsWith(`${SITE_BASE}/`)
            ? trimmedSrc.slice(SITE_BASE.length + 1)
            : resolveRelativeRepoPath(trimmedSrc, sourceRepoPath);

        node.properties.src = withBase(repoRelPath);

        const dims = readImageDimensions(path.resolve(repoRoot, repoRelPath));
        if (dims) {
          node.properties.width = dims.width;
          node.properties.height = dims.height;
        }
      }

      if (node.properties.loading === undefined) {
        node.properties.loading = 'lazy';
      }
      if (node.properties.decoding === undefined) {
        node.properties.decoding = 'async';
      }

      // Never combine fetchpriority="low" with loading="lazy"
      if (
        String(node.properties.fetchpriority ?? node.properties.fetchPriority ?? '').toLowerCase() ===
        'low'
      ) {
        delete node.properties.fetchpriority;
        delete node.properties.fetchPriority;
      }
    }
  });
}

function transformMermaidFences(tree: Root): void {
  visit(tree, 'element', (node, index, parent) => {
    if (!parent || index === undefined) {
      return;
    }
    const preInfo = getPreCodeInfo(node);
    if (!preInfo || preInfo.lang !== 'mermaid') {
      return;
    }
    if (hasClass(parent as Element, 'mermaid-scroll')) {
      return;
    }

    const diagramSource = extractText(preInfo.codeChild ?? node, false).replace(/\n$/, '');
    parent.children[index] = h(
      'figure',
      { className: ['mermaid-card'], dataMermaidCard: true, dataPagefindIgnore: true },
      [
        h(
          'div',
          {
            className: ['mermaid-scroll'],
            tabIndex: 0,
            role: 'region',
            ariaLabel: 'Signal flow diagram',
          },
          [h('pre', { className: ['mermaid'] }, [{ type: 'text', value: diagramSource }])],
        ),
      ],
    );
  });
}

function wrapPanelJsonAppendix(tree: Root, sourceRepoPath: string): void {
  if (sourceRepoPath !== 'panel_svg_spec.md') {
    return;
  }

  let sawSection8Heading = false;
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (!node || node.type !== 'element') {
      continue;
    }

    if (node.tagName === 'h2') {
      const id = String(node.properties?.id ?? '');
      const headingText = extractText(node, true);
      sawSection8Heading =
        id.startsWith('8-machine-readable-geometry') ||
        /machine-readable geometry/i.test(headingText);
      continue;
    }

    if (sawSection8Heading && getPreCodeInfo(node)?.lang === 'json') {
      const jsonText = extractText(node, false).replace(/\n$/, '');
      const lineCount = jsonText ? jsonText.split('\n').length : 0;

      tree.children[i] = h(
        'details',
        {
          className: ['spec-disclosure', 'json-appendix-disclosure'],
          dataPagefindIgnore: true,
        },
        [
          h('summary', {}, [
            h('span', { className: ['disclosure-title'] }, [
              { type: 'text', value: `Expand Machine-Readable Geometry JSON (${lineCount} lines)` },
            ]),
            h('span', { className: ['disclosure-meta', 'mono'] }, [
              { type: 'text', value: 'panel_svg_spec.md §8 · 1:1 mm coordinates' },
            ]),
          ]),
          h('div', { className: ['disclosure-body'] }, [node]),
        ],
      );
      break;
    }
  }
}

function getHeaderLabels(tableEl: Element): string[] {
  const thead = tableEl.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'thead',
  );
  const firstRow = thead?.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'tr',
  );
  if (!firstRow) {
    return [];
  }

  const labels: string[] = [];
  for (const cell of firstRow.children) {
    if (cell.type !== 'element' || (cell.tagName !== 'th' && cell.tagName !== 'td')) {
      continue;
    }
    cell.tagName = 'th';
    cell.properties ??= {};
    cell.properties.scope = 'col';
    labels.push(extractText(cell, true).replace(/\s+/g, ' ').trim());
  }
  return labels;
}

function promoteTbodyRowHeaders(tableEl: Element): void {
  for (const section of tableEl.children) {
    if (section.type !== 'element' || section.tagName !== 'tbody') {
      continue;
    }
    for (const row of section.children) {
      if (row.type !== 'element' || row.tagName !== 'tr') {
        continue;
      }
      const firstCell = row.children.find(
        (cell): cell is Element =>
          cell.type === 'element' && (cell.tagName === 'td' || cell.tagName === 'th'),
      );
      if (firstCell) {
        firstCell.tagName = 'th';
        firstCell.properties ??= {};
        firstCell.properties.scope = 'row';
      }
    }
  }
}

function wrapAccessibleTables(tree: Root): void {
  let lastHeadingId = '';
  let fallbackCounter = 0;

  const processParent = (parent: Parent): void => {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (!child || child.type !== 'element') {
        continue;
      }

      if (HEADING_TAGS.has(child.tagName)) {
        const headingId = child.properties?.id;
        if (typeof headingId === 'string' && headingId) {
          lastHeadingId = headingId;
        }
        continue;
      }

      if (hasClass(child, 'table-wrapper')) {
        continue;
      }

      if (child.tagName === 'table') {
        if (hasNestedTable(child)) {
          addClass(child, 'layout-table');
          processParent(child);
          continue;
        }

        const labels = getHeaderLabels(child);
        if (labels.length === 0) {
          addClass(child, 'layout-table');
          processParent(child);
          continue;
        }

        promoteTbodyRowHeaders(child);

        const kind = labels.length >= 5 ? 'wide' : 'narrow';
        child.properties ??= {};
        child.properties.dataTableKind = kind;

        if (kind === 'narrow' && labels.length > 1) {
          const cssVars = labels
            .slice(1)
            .map((label, idx) => `--label-${idx + 2}: "${escapeCssString(label)}"`)
            .join('; ');
          const prevStyle = typeof child.properties.style === 'string' ? child.properties.style : '';
          child.properties.style = prevStyle
            ? `${prevStyle.replace(/;\s*$/, '')}; ${cssVars};`
            : `${cssVars};`;
        }

        let labelledById = lastHeadingId;
        if (!labelledById) {
          fallbackCounter += 1;
          labelledById = `table-region-${fallbackCounter}`;
          const existingCaption = child.children.find(
            (c): c is Element => c.type === 'element' && c.tagName === 'caption',
          );
          if (existingCaption) {
            existingCaption.properties ??= {};
            existingCaption.properties.id ??= labelledById;
            labelledById = String(existingCaption.properties.id);
          } else {
            child.children.unshift(
              h('caption', { id: labelledById, className: ['visually-hidden'] }, [
                { type: 'text', value: 'Data table' },
              ]),
            );
          }
        }

        parent.children[i] = h(
          'div',
          {
            className: ['table-wrapper'],
            tabIndex: 0,
            role: 'region',
            ariaLabelledBy: [labelledById],
          },
          [child],
        );
        continue;
      }

      processParent(child);
    }
  };

  processParent(tree);
}

function markFormulaGrids(tree: Root): void {
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'ul') {
      return;
    }
    const listItems = node.children.filter(
      (child): child is Element => child.type === 'element' && child.tagName === 'li',
    );
    if (listItems.length >= 2 && listItems.every((li) => containsKatexDisplay(li))) {
      addClass(node, 'formula-grid');
    }
  });
}

const PATCH_GUIDE_FILE_RE = /^patches\/0[1-8][^/]*\.md$/;

function matchControlIdFromCell(rawText: string): PanelControlId | null {
  const norm = rawText.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!norm) return null;
  if (norm.includes('SLEW IN') || norm.includes('J2')) return 'j2';
  if (norm.includes('INV OUT') || norm.includes('INV_OUT') || norm.includes('J4')) return 'j4';
  if (/\bIN\b/.test(norm) || norm.includes('J1')) return 'j1';
  if (/\bOUT\b/.test(norm) || norm.includes('J3')) return 'j3';
  if (norm.includes('LEFT TOGGLE') || norm.includes('SW1') || norm.includes('SMOOTH')) return 'sw1';
  if (
    norm.includes('RIGHT TOGGLE') ||
    norm.includes('SW2') ||
    norm.includes('SLOW') ||
    norm.includes('FAST')
  ) {
    return 'sw2';
  }
  if (norm.includes('LED')) return 'led1';
  if (norm.includes('GAIN') || norm.includes('RV1')) return 'rv1';
  if (norm.includes('ATK') || norm.includes('RV2')) return 'rv2';
  if (norm.includes('REL') || norm.includes('RV3')) return 'rv3';
  if (norm.includes('OFFSET') || norm.includes('RV4')) return 'rv4';
  return null;
}

function isTopBackLinkParagraph(node: RootContent): boolean {
  if (node.type !== 'element' || node.tagName !== 'p') return false;
  const links = findDescendants(node, (el) => el.tagName === 'a');
  return (
    links.length === 1 &&
    (links[0]?.properties?.href === 'README.md' ||
      /All Patch Guides/i.test(extractText(node, true)))
  );
}

function isBottomPatchNavParagraph(node: RootContent): boolean {
  if (node.type !== 'element' || node.tagName !== 'p') return false;
  const links = findDescendants(node, (el) => el.tagName === 'a');
  if (links.length === 0) return false;
  return links.some((a) => {
    const href = String(a.properties?.href ?? '');
    const label = extractText(a, true);
    return href === 'README.md' || /All Patch Guides/i.test(label);
  });
}

function stripPatchGitHubNav(tree: Root): void {
  const firstH1Idx = tree.children.findIndex(
    (node) => node.type === 'element' && node.tagName === 'h1',
  );
  if (firstH1Idx > 0) {
    tree.children = tree.children.filter(
      (node, idx) => idx >= firstH1Idx || !isTopBackLinkParagraph(node),
    );
  }

  // Strip trailing GitHub nav paragraph and immediately preceding <hr>
  while (tree.children.length > 0) {
    const last = tree.children[tree.children.length - 1];
    if (!last) break;
    if (last.type === 'text' && !last.value.trim()) {
      tree.children.pop();
      continue;
    }
    if (isBottomPatchNavParagraph(last)) {
      tree.children.pop();
      // Drop whitespace text before trailing <hr>
      while (
        tree.children.length > 0 &&
        tree.children[tree.children.length - 1]?.type === 'text' &&
        !(tree.children[tree.children.length - 1] as { value: string }).value.trim()
      ) {
        tree.children.pop();
      }
      const prev = tree.children[tree.children.length - 1];
      if (prev?.type === 'element' && prev.tagName === 'hr') {
        tree.children.pop();
      }
    }
    break;
  }
}

function tagPatchSettingsTables(tree: Root): void {
  let inSettingsSection = false;
  let presetTableIndex = 0;

  for (const node of tree.children) {
    if (node.type !== 'element') continue;

    if (node.tagName === 'h2') {
      const id = String(node.properties?.id ?? '');
      inSettingsSection = id === 'front-panel-starting-settings';
      presetTableIndex = 0;
      continue;
    }

    if (!inSettingsSection) continue;

    const tables = node.tagName === 'table' ? [node] : findDescendants(node, (el) => el.tagName === 'table');
    for (const table of tables) {
      table.properties ??= {};
      table.properties.dataPresetIndex = String(presetTableIndex);
      presetTableIndex += 1;

      const tbodies = table.children.filter(
        (c): c is Element => c.type === 'element' && c.tagName === 'tbody',
      );
      for (const tbody of tbodies) {
        for (const row of tbody.children) {
          if (row.type !== 'element' || row.tagName !== 'tr') continue;
          const firstCell = row.children.find(
            (c): c is Element => c.type === 'element' && (c.tagName === 'td' || c.tagName === 'th'),
          );
          if (!firstCell) continue;
          const ctrlId = matchControlIdFromCell(extractText(firstCell, true));
          if (ctrlId) {
            row.properties ??= {};
            row.properties.dataControl = ctrlId;
            row.properties.tabIndex = 0;
          }
        }
      }
    }
  }
}

function stripLeadingH1(tree: Root): void {
  const firstElementIdx = tree.children.findIndex((node) => node.type === 'element');
  if (firstElementIdx !== -1) {
    const firstEl = tree.children[firstElementIdx];
    if (firstEl?.type === 'element' && firstEl.tagName === 'h1') {
      tree.children.splice(firstElementIdx, 1);
    }
  }
}

function suppressSectionByHeading(tree: Root, targetHeadingId: string): void {
  const startIdx = tree.children.findIndex(
    (node) =>
      node.type === 'element' &&
      node.tagName === 'h2' &&
      node.properties?.id === targetHeadingId,
  );
  if (startIdx === -1) {
    return;
  }

  let endIdx = tree.children.length;
  for (let i = startIdx + 1; i < tree.children.length; i++) {
    const node = tree.children[i];
    if (node?.type === 'element' && node.tagName === 'h2') {
      endIdx = i;
      break;
    }
  }

  tree.children.splice(startIdx, endIdx - startIdx);
}

const CHECKLIST_DETAIL_RE = /^checklists\/0[1-5].*\.md$/;
const COPYABLE_SHELL_LANGS = new Set(['bash', 'sh', 'shell']);
const BLOCK_LEVEL_TAGS = new Set([
  'ul',
  'ol',
  'div',
  'blockquote',
  'pre',
  'table',
  'details',
  'hr',
  'figure',
]);
const CRITICAL_CALLOUT_RE = /\bCRITICAL\b|DO\s+NOT\s+SOLDER|ABORT\s+IMMEDIATELY/i;
const PCB_REMARK_RE = /(?:Please replace the 5x5mm|Eurorack front panel:)/i;
const INLINE_CRITICAL_LI_RE = /ABORT\s+IMMEDIATELY|NEVER\s+substitute\s+a\s+Schottky/i;

function isWhitespaceText(node: RootContent): boolean {
  return node.type === 'text' && !node.value.trim();
}

function getInputCheckbox(node: RootContent): Element | null {
  if (node.type !== 'element' || node.tagName !== 'input') {
    return null;
  }
  return String(node.properties?.type ?? 'checkbox').toLowerCase() === 'checkbox' ? node : null;
}

function createCopyButton(label: string, copyText: string): Element {
  return h(
    'button',
    {
      type: 'button',
      className: ['copy-block-btn'],
      dataCopyTrigger: true,
      dataCopyText: copyText,
      dataPagefindIgnore: true,
    },
    [{ type: 'text', value: label }],
  );
}

function transformChecklistLinksAndCallouts(parent: Parent): void {
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children[i];
    if (!child || child.type !== 'element') {
      continue;
    }

    const preInfo = getPreCodeInfo(child);
    if (preInfo && COPYABLE_SHELL_LANGS.has((preInfo.lang ?? '').toLowerCase())) {
      const cmdText = extractText(preInfo.codeChild ?? child, false).replace(/\n$/, '').trim();
      parent.children[i] = h('div', { className: ['copy-block'], dataCopyable: true }, [
        h('div', { className: ['copy-block-bar'] }, [
          h('span', { className: ['copy-block-label', 'mono'] }, [
            { type: 'text', value: preInfo.lang ?? 'shell' },
          ]),
          createCopyButton('Copy', cmdText),
        ]),
        child,
      ]);
      continue;
    }

    if (child.tagName === 'blockquote') {
      // Transform any nested links inside blockquote before wrapping its body
      transformChecklistLinksAndCallouts(child);
      const rawText = extractText(child, true).replace(/\s+/g, ' ').trim();
      if (PCB_REMARK_RE.test(rawText)) {
        const remarkText = rawText.replace(/^[`"“]+|[`"”]+$/g, '').trim();
        addClass(child, 'callout', 'callout-remark');
        child.properties ??= {};
        child.properties.dataCopyable = true;
        child.children = [
          h('div', { className: ['callout-remark-bar'] }, [
            h('span', { className: ['callout-remark-label'] }, [
              { type: 'text', value: 'JLCPCB PCB Remark' },
            ]),
            createCopyButton('Copy Remark', remarkText),
          ]),
          h('div', { className: ['callout-content'] }, child.children),
        ];
      } else if (CRITICAL_CALLOUT_RE.test(rawText)) {
        addClass(child, 'callout', 'callout-critical');
        child.properties ??= {};
        child.properties.dataAlert = 'critical';
        child.children = [
          h('div', { className: ['callout-layout'] }, [
            h('span', { className: ['callout-badge'], ariaHidden: 'true' }, [
              { type: 'text', value: '▲' },
            ]),
            h('div', { className: ['callout-content'] }, child.children),
          ]),
        ];
      } else {
        addClass(child, 'callout', 'callout-info');
        child.children = [
          h('div', { className: ['callout-layout'] }, [
            h('span', { className: ['callout-badge'], ariaHidden: 'true' }, [
              { type: 'text', value: 'i' },
            ]),
            h('div', { className: ['callout-content'] }, child.children),
          ]),
        ];
      }
      continue;
    }

    if (child.tagName === 'li' && !hasClass(child, 'task-list-item')) {
      const liText = extractText(child, true);
      if (INLINE_CRITICAL_LI_RE.test(liText)) {
        addClass(child, 'checklist-alert-critical');
        child.properties ??= {};
        child.properties.dataAlert = 'critical';
        const alreadyHasBadge = child.children.some(
          (node) => node.type === 'element' && hasClass(node, 'callout-badge'),
        );
        if (!alreadyHasBadge) {
          child.children = [
            h('span', { className: ['callout-badge'], ariaHidden: 'true' }, [
              { type: 'text', value: '▲' },
            ]),
            h('div', { className: ['callout-content'] }, child.children),
          ];
        }
      }
    }

    transformChecklistLinksAndCallouts(child);
  }
}

function createLightboxImageTrigger(img: Element): Element {
  const src = String(img.properties?.src ?? '');
  const alt = String(img.properties?.alt ?? '');
  const width = img.properties?.width;
  const height = img.properties?.height;

  addClass(img, 'checklist-img');
  return h(
    'button',
    {
      type: 'button',
      className: ['checklist-img-trigger', 'lightbox-trigger'],
      dataLightboxSrc: src,
      dataLightboxAlt: alt,
      ...(width ? { dataLightboxWidth: String(width) } : {}),
      ...(height ? { dataLightboxHeight: String(height) } : {}),
      ariaLabel: alt ? `Zoom reference photo: ${alt}` : 'Zoom reference photo',
    },
    [
      img,
      h(
        'span',
        { className: ['lightbox-zoom-chip'], ariaHidden: 'true', dataPagefindIgnore: true },
        [{ type: 'text', value: 'Zoom' }],
      ),
    ],
  );
}

function wrapTriggerInPlacementCard(trigger: Element): Element {
  return h('div', { className: ['placement-card'], dataPlacementCard: true }, [
    h('div', { className: ['placement-card-actions'], dataPagefindIgnore: true }, [
      h(
        'button',
        {
          type: 'button',
          className: ['placement-reveal-btn'],
          dataPlacementReveal: true,
          hidden: true,
        },
        [{ type: 'text', value: 'Show photo' }],
      ),
    ]),
    trigger,
  ]);
}

function wrapChecklistImages(
  parent: Parent,
  enablePlacementCollapse: boolean,
  insideTaskLi: boolean,
): void {
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children[i];
    if (!child || child.type !== 'element') {
      continue;
    }

    if (hasClass(child, 'lightbox-trigger') || child.properties?.dataPlacementCard) {
      continue;
    }

    // Unwrap <p> containing solely an <img> so placement-card stays valid block markup
    if (child.tagName === 'p') {
      const nonEmpty = child.children.filter((c) => !isWhitespaceText(c));
      if (
        nonEmpty.length === 1 &&
        nonEmpty[0]?.type === 'element' &&
        nonEmpty[0].tagName === 'img'
      ) {
        const trigger = createLightboxImageTrigger(nonEmpty[0]);
        parent.children[i] =
          insideTaskLi && enablePlacementCollapse ? wrapTriggerInPlacementCard(trigger) : trigger;
        continue;
      }
    }

    if (child.tagName === 'img') {
      const trigger = createLightboxImageTrigger(child);
      parent.children[i] =
        insideTaskLi && enablePlacementCollapse ? wrapTriggerInPlacementCard(trigger) : trigger;
      continue;
    }

    wrapChecklistImages(
      child,
      enablePlacementCollapse,
      insideTaskLi || (child.tagName === 'li' && hasClass(child, 'task-list-item')),
    );
  }
}

function finalizeTaskInput(input: Element, itemId: string): void {
  const props = (input.properties ??= {});
  const wasCheckedInSource =
    props.checked === true || props.checked === '' || props.checked === 'checked';
  delete props.disabled;
  delete props.checked;
  addClass(input, 'checklist-checkbox');
  props.dataChecklistCheckbox = true;
  props.dataItemId = itemId;
  if (wasCheckedInSource) {
    props.dataRepoVerified = true;
  }
}

function transformChecklistItems(tree: Root, checklistSlug: string): void {
  const seenCounts = new Map<string, number>();
  let currentHeadingId = 'root';

  const walk = (parent: Parent): void => {
    for (const child of parent.children) {
      if (child.type !== 'element') {
        continue;
      }

      if (HEADING_TAGS.has(child.tagName) && typeof child.properties?.id === 'string') {
        currentHeadingId = child.properties.id;
        continue;
      }

      if (child.tagName === 'li' && hasClass(child, 'task-list-item')) {
        const firstParagraph = child.children.find(
          (node): node is Element =>
            node.type === 'element' &&
            node.tagName === 'p' &&
            node.children.some((inner) => getInputCheckbox(inner) !== null),
        );

        const directInput = child.children
          .map((node) => getInputCheckbox(node))
          .find((el): el is Element => el !== null);

        if (firstParagraph) {
          const input = firstParagraph.children
            .map((node) => getInputCheckbox(node))
            .find((el): el is Element => el !== null)!;
          const primaryText = extractText(firstParagraph, true).replace(/\s+/g, ' ').trim();
          const itemId = generateChecklistItemId(
            checklistSlug,
            currentHeadingId,
            primaryText,
            seenCounts,
          );
          finalizeTaskInput(input, itemId);
          const inlineBodyNodes = firstParagraph.children.filter((node) => node !== input);
          firstParagraph.tagName = 'label';
          addClass(firstParagraph, 'checklist-item-label');
          firstParagraph.children = [
            input,
            h('span', { className: ['checklist-item-text'] }, inlineBodyNodes),
          ];
          child.properties ??= {};
          child.properties.dataChecklistItem = true;
          child.properties.dataItemId = itemId;
        } else if (directInput) {
          const inlineEndIdx = child.children.findIndex(
            (node) => node.type === 'element' && BLOCK_LEVEL_TAGS.has(node.tagName),
          );
          const splitIdx = inlineEndIdx === -1 ? child.children.length : inlineEndIdx;
          const inlineNodes = child.children.slice(0, splitIdx);
          const trailingBlocks = child.children.slice(splitIdx);
          const primaryText = inlineNodes
            .map((n) => extractText(n, true))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          const itemId = generateChecklistItemId(
            checklistSlug,
            currentHeadingId,
            primaryText,
            seenCounts,
          );
          finalizeTaskInput(directInput, itemId);
          const inlineBodyNodes = inlineNodes.filter((node) => node !== directInput);
          child.properties ??= {};
          child.properties.dataChecklistItem = true;
          child.properties.dataItemId = itemId;
          child.children = [
            h('label', { className: ['checklist-item-label'] }, [
              directInput,
              h('span', { className: ['checklist-item-text'] }, inlineBodyNodes),
            ]),
            ...trailingBlocks,
          ];
        }
      }

      walk(child);
    }
  };

  walk(tree);
}

function transformChecklistDocument(tree: Root, sourceRepoPath: string): void {
  const checklistSlug = path.posix.basename(sourceRepoPath, '.md');
  const enablePlacementCollapse =
    checklistSlug === '02-pcba-part-alignment' || checklistSlug === '04-hand-assembly';

  transformChecklistLinksAndCallouts(tree);
  wrapChecklistImages(tree, enablePlacementCollapse, false);
  transformChecklistItems(tree, checklistSlug);
}

/**
 * Single-source rehype transform module unifying heading-slug parity, route/passthrough rewriting,
 * GitHub CAD/Python fallbacks, image dimension injection, Mermaid wrappers, §8 JSON disclosure,
 * checklist interactivity transforms, hub section suppression, responsive formula grids,
 * and keyboard-focusable accessible table containers.
 */
export const rehypeSingleSource: Plugin<[SingleSourceRehypeOptions], Root> = (options) => {
  const repoRoot = path.resolve(options.repoRoot);

  return (tree, file) => {
    const sourceRepoPath = resolveSourceRepoPath(repoRoot, file, options.sourceRepoPath);

    assignHeadingIds(tree);
    if (sourceRepoPath === 'patches/README.md') {
      stripLeadingH1(tree);
      suppressSectionByHeading(tree, 'patch-guides-index');
    } else if (sourceRepoPath === 'checklists/README.md') {
      suppressSectionByHeading(tree, 'workflow-order');
    } else if (PATCH_GUIDE_FILE_RE.test(sourceRepoPath)) {
      stripPatchGitHubNav(tree);
      tagPatchSettingsTables(tree);
    }
    rewriteLinksAndImages(tree, sourceRepoPath, repoRoot);
    if (CHECKLIST_DETAIL_RE.test(sourceRepoPath)) {
      transformChecklistDocument(tree, sourceRepoPath);
    }
    transformMermaidFences(tree);
    wrapPanelJsonAppendix(tree, sourceRepoPath);
    wrapAccessibleTables(tree);
    markFormulaGrids(tree);
  };
};
