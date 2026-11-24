import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Parent, Properties, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import type { VFile } from 'vfile';
import { readImageDimensions } from '../lib/image-dimensions.ts';
import { resolveRelativeRepoPath, resolveRepoHref } from '../lib/content-manifest.ts';
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
        node.properties ??= {};
        node.properties.href = resolveRepoHref(href, sourceRepoPath);
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
    parent.children[index] = h('figure', { className: ['mermaid-card'], dataMermaidCard: true }, [
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
    ]);
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

/**
 * Single-source rehype transform module unifying heading-slug parity, route/passthrough rewriting,
 * GitHub CAD/Python fallbacks, image dimension injection, Mermaid wrappers, §8 JSON disclosure,
 * hub section suppression, responsive formula grids, and keyboard-focusable accessible table containers.
 */
export const rehypeSingleSource: Plugin<[SingleSourceRehypeOptions], Root> = (options) => {
  const repoRoot = path.resolve(options.repoRoot);

  return (tree, file) => {
    const sourceRepoPath = resolveSourceRepoPath(repoRoot, file, options.sourceRepoPath);

    assignHeadingIds(tree);
    if (sourceRepoPath === 'patches/README.md') {
      suppressSectionByHeading(tree, 'patch-guides-index');
    }
    rewriteLinksAndImages(tree, sourceRepoPath, repoRoot);
    transformMermaidFences(tree);
    wrapPanelJsonAppendix(tree, sourceRepoPath);
    wrapAccessibleTables(tree);
    markFormulaGrids(tree);
  };
};
