import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import {
  BUILD_CHECKLISTS_CATALOG,
  TOTAL_CHECKLIST_ITEMS,
} from '../data/build-checklists.ts';
import { PATCH_STATES, validatePatchStates } from '../data/patch-states.ts';
import {
  ALLOWLISTED_MARKDOWN_FILES,
  PATCH_GUIDE_FILES,
  REFERENCE_SPECS_CATALOG,
} from './content-manifest.ts';
import {
  CANONICAL_ROUTES,
  SITE_BASE,
  SITE_ORIGIN,
  normalizeRoutePath,
} from './routes.ts';
import {
  isExcludedRepoPath,
  resolvePassthroughFiles,
  resolveSafeFileUnderRoot,
} from './static-passthrough.ts';

/** Configuration options for built-site artifact verification. */
export interface VerifyBuiltSiteOptions {
  distDir: string;
  repoRoot: string;
  implementedRoutes?: readonly string[];
  requirePagefind?: boolean;
  verifyReadme?: boolean;
}

/** Summary report returned by verifyBuiltSite. */
export interface SiteContractResult {
  checkedHtmlRoutes: string[];
  verifiedPassthroughs: number;
  verifiedImages: number;
  verifiedLinks: number;
  errors: string[];
}

const CANONICAL_ROUTE_SET = new Set<string>(CANONICAL_ROUTES);
const POSITIVE_INT_RE = /^[1-9]\d*$/;
const EXTERNAL_PROTO_RE = /^(?:https?:|mailto:|tel:|data:|blob:)/i;

/** Required self-hosted @fontsource font families present as .woff2 in distDir. */
export const REQUIRED_FONT_FAMILIES = [
  'barlow-condensed',
  'space-grotesk',
  'ibm-plex-sans',
  'ibm-plex-mono',
] as const;

/** Third-party CDN hostnames forbidden in built HTML, CSS, and JS assets. */
export const EXTERNAL_CDN_DOMAINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
] as const;

/** Detects hardcoded inline hex color styling inside Mermaid diagrams. */
export const MERMAID_HEX_STYLE_RE =
  /^\s*(?:style|classDef|linkStyle)\b[^\n]*#[0-9a-f]{3,8}\b|\b(?:fill|stroke|color)\s*:\s*#[0-9a-f]{3,8}\b/im;

const MERMAID_ARROW_RE =
  /--+\s+[^-]+?\s+--+>|-\.\s+[^.]+?\s+\.-+>|==+\s+[^=]+?\s+==+>|(?:<)?(?:--+>|---+|-\.+->|-\.-|==+>|===+|--+o|--+x|<--+>|o--+o|x--+x|~~~)/g;

interface MermaidSubgraphFrame {
  id: string;
  direction: string | null;
  parentId: string | null;
}

function stripMermaidLabels(rawLine: string): string {
  let cleaned = rawLine
    .replace(/%%.*$/, '')
    .replace(/"[^"]*"/g, '""')
    .replace(/\|[^|]*\|/g, ' ')
    .replace(/:::[\w-]+/g, '');
  // Strip bracketed/parenthesized/braced node labels cleanly (iteratively for nested ((...)) etc.)
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned
      .replace(/\[[^[\]]*\]/g, '')
      .replace(/\([^()]*\)/g, '')
      .replace(/\{[^{}]*\}/g, '');
  }
  return cleaned;
}

function collectMermaidAncestors(
  scopeId: string | null,
  subgraphById: ReadonlyMap<string, MermaidSubgraphFrame>,
): Set<string> {
  const ancestors = new Set<string>();
  let cur = scopeId;
  while (cur) {
    ancestors.add(cur);
    cur = subgraphById.get(cur)?.parentId ?? null;
  }
  return ancestors;
}

function extractMermaidNodeIds(segment: string): string[] {
  return segment
    .split('&')
    .map((part) => part.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1] ?? '')
    .filter(Boolean);
}

function hasUnsharedMixedAncestor(
  primary: ReadonlySet<string>,
  other: ReadonlySet<string>,
  mixedIds: ReadonlySet<string>,
): boolean {
  for (const id of primary) {
    if (!other.has(id) && mixedIds.has(id)) {
      return true;
    }
  }
  return false;
}

/**
 * Return true if a Mermaid `flowchart LR` / `graph LR` diagram contains a subgraph
 * with a non-LR `direction` and at least one edge crossing that subgraph's boundary.
 */
export function hasMixedLrSubgraphCrossEdges(source: string): boolean {
  const rawLines = source.split(/\r?\n/);
  let headerChecked = false;
  const stack: MermaidSubgraphFrame[] = [];
  const subgraphs: MermaidSubgraphFrame[] = [];
  const subgraphById = new Map<string, MermaidSubgraphFrame>();
  const nodeScope = new Map<string, string | null>();
  const edges: Array<{ from: string; to: string }> = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.replace(/%%.*$/, '').trim();
    if (!trimmed) {
      continue;
    }

    if (!headerChecked) {
      headerChecked = true;
      if (!/^(?:flowchart|graph)\s+LR\b/i.test(trimmed)) {
        return false;
      }
      continue;
    }

    const sgMatch = trimmed.match(/^subgraph\b\s*(.*)$/i);
    if (sgMatch) {
      const rest = (sgMatch[1] ?? '').trim();
      const idMatch = rest.match(/^([^\s\["']+)/);
      const id = idMatch?.[1] ?? `__subgraph_${subgraphs.length}`;
      const frame: MermaidSubgraphFrame = {
        id,
        direction: null,
        parentId: stack[stack.length - 1]?.id ?? null,
      };
      stack.push(frame);
      subgraphs.push(frame);
      subgraphById.set(id, frame);
      continue;
    }

    if (/^end\b/i.test(trimmed)) {
      stack.pop();
      continue;
    }

    const dirMatch = trimmed.match(/^direction\s+(LR|RL|TB|TD|BT)\b/i);
    if (dirMatch) {
      const currentFrame = stack[stack.length - 1];
      if (currentFrame && dirMatch[1]) {
        currentFrame.direction = dirMatch[1].toUpperCase();
      }
      continue;
    }

    if (/^(?:classDef|style|linkStyle|click|class|accTitle|accDescr)\b/i.test(trimmed)) {
      continue;
    }

    const cleaned = stripMermaidLabels(trimmed);
    const currentScope = stack[stack.length - 1]?.id ?? null;
    const segments = cleaned.split(MERMAID_ARROW_RE);
    const groupIds = segments.map(extractMermaidNodeIds);

    for (const ids of groupIds) {
      for (const id of ids) {
        if (!nodeScope.has(id)) {
          nodeScope.set(id, currentScope);
        }
      }
    }

    if (segments.length === 1) {
      continue;
    }

    for (let i = 0; i < groupIds.length - 1; i += 1) {
      const left = groupIds[i] ?? [];
      const right = groupIds[i + 1] ?? [];
      for (const from of left) {
        for (const to of right) {
          edges.push({ from, to });
        }
      }
    }
  }

  const mixedIds = new Set(
    subgraphs
      .filter((sg) => sg.direction !== null && sg.direction !== 'LR')
      .map((sg) => sg.id),
  );
  if (mixedIds.size === 0) {
    return false;
  }

  for (const { from, to } of edges) {
    const scopeA = subgraphById.has(from) ? from : (nodeScope.get(from) ?? null);
    const scopeB = subgraphById.has(to) ? to : (nodeScope.get(to) ?? null);
    if (scopeA === scopeB) {
      continue;
    }
    const ancA = collectMermaidAncestors(scopeA, subgraphById);
    const ancB = collectMermaidAncestors(scopeB, subgraphById);
    if (
      hasUnsharedMixedAncestor(ancA, ancB, mixedIds) ||
      hasUnsharedMixedAncestor(ancB, ancA, mixedIds)
    ) {
      return true;
    }
  }

  return false;
}

const NON_MERMAID_ROUTES = new Set<string>([
  '/',
  '/patches/',
  '/build/',
  ...BUILD_CHECKLISTS_CATALOG.map((c) => c.route),
  '/origin/',
  '/downloads/',
  '/specs/',
  '/specs/panel-svg-spec/',
]);
const CHECKLIST_DETAIL_META_BY_ROUTE = new Map(
  BUILD_CHECKLISTS_CATALOG.map((c) => [c.route as string, c]),
);
const REFERENCE_SPEC_DETAIL_ROUTES = new Set<string>(
  REFERENCE_SPECS_CATALOG.map((spec) => spec.route),
);
const DIAGRAM_KATEX_SPEC_DISPLAY_COUNTS: Readonly<Record<string, number>> = {
  '/specs/base-circuit/': 4,
  '/specs/circuit-review/': 3,
  '/specs/design-spec/': 0,
};

function verifyNoMermaidOnRoute(
  route: string,
  doc: Document,
  distDir: string,
  errors: string[],
): void {
  if (doc.querySelectorAll('.mermaid').length > 0) {
    errors.push(`${route}: unexpected .mermaid block on non-diagram route`);
  }

  for (const script of doc.querySelectorAll('script')) {
    const src = script.getAttribute('src')?.trim() ?? '';
    if (!src) {
      if (/mermaid/i.test(script.textContent ?? '')) {
        errors.push(`${route}: unexpected inline Mermaid script on non-diagram route`);
      }
      continue;
    }

    if (/mermaid/i.test(src)) {
      errors.push(`${route}: unexpected Mermaid script bundle (${src})`);
      continue;
    }

    const resolvedScript = resolveDistFile(distDir, src);
    if (resolvedScript && /mermaid/i.test(fs.readFileSync(resolvedScript, 'utf8'))) {
      errors.push(`${route}: referenced script imports or mentions Mermaid (${src})`);
    }
  }
}

function verifyReferenceSpecRoute(route: string, doc: Document, errors: string[]): void {
  if (doc.querySelectorAll('.katex-error').length > 0) {
    errors.push(`${route}: rendered KaTeX parse error (.katex-error) detected`);
  }

  const companionLinks = [...doc.querySelectorAll('.companion-banner a[href]')];
  const hasOriginOrHardwareCompanion = companionLinks.some((a) => {
    const href = a.getAttribute('href') ?? '';
    const target = normalizeRoutePath(href);
    return target === '/origin/' || target === '/hardware/';
  });
  if (!hasOriginOrHardwareCompanion) {
    errors.push(`${route}: missing .companion-banner link to /origin/ or /hardware/`);
  }

  for (const table of doc.querySelectorAll('.doc-prose table:not(.layout-table)')) {
    if (table.closest('table.layout-table') && !table.closest('.table-wrapper')) {
      errors.push(`${route}: data <table> missing .table-wrapper container`);
      continue;
    }
    const wrapper = table.parentElement;
    if (!wrapper || !wrapper.classList.contains('table-wrapper')) {
      errors.push(`${route}: data <table> missing direct .table-wrapper container`);
      continue;
    }
    const tabIndex = wrapper.getAttribute('tabindex');
    const role = wrapper.getAttribute('role');
    const labelledBy = wrapper.getAttribute('aria-labelledby')?.trim() ?? '';
    if (tabIndex !== '0' || role !== 'region' || !labelledBy || !doc.getElementById(labelledBy)) {
      errors.push(
        `${route}: .table-wrapper missing tabindex="0", role="region", or valid aria-labelledby (${labelledBy || 'empty'})`,
      );
    }
  }

  if (route in DIAGRAM_KATEX_SPEC_DISPLAY_COUNTS) {
    if (doc.querySelectorAll('.mermaid').length === 0) {
      errors.push(`${route}: expected at least one .mermaid diagram`);
    }
    if (doc.querySelectorAll('.katex').length === 0) {
      errors.push(`${route}: expected rendered .katex math expressions`);
    }
    const expectedDisplay = DIAGRAM_KATEX_SPEC_DISPLAY_COUNTS[route] ?? 0;
    const actualDisplay = doc.querySelectorAll('.katex-display').length;
    if (actualDisplay !== expectedDisplay) {
      errors.push(
        `${route}: expected ${expectedDisplay} .katex-display blocks, found ${actualDisplay}`,
      );
    }
  }

  if (route === '/specs/panel-svg-spec/') {
    const details = doc.querySelector('.doc-prose details[data-pagefind-ignore]');
    if (!details || !details.querySelector('pre')) {
      errors.push(`${route}: §8 JSON code block missing <details data-pagefind-ignore> wrapper`);
    } else if (details.querySelector('summary h1, summary h2, summary h3, summary h4, summary h5, summary h6')) {
      errors.push(`${route}: <summary> must not contain heading elements`);
    }
  }
}

function verifyPatchGuideDetailRoute(route: string, doc: Document, errors: string[]): void {
  const prose = doc.querySelector('.doc-prose');
  if (!prose) {
    errors.push(`${route}: missing .doc-prose container`);
    return;
  }

  const text = prose.textContent ?? '';
  if (text.includes('← All Patch Guides') || text.includes('← Previous:')) {
    errors.push(`${route}: GitHub-only top/bottom nav line was not stripped`);
  }

  if (doc.querySelectorAll('tr[data-control]').length === 0) {
    errors.push(`${route}: Front-Panel Starting Settings rows missing data-control attributes`);
  }

  if (doc.querySelectorAll('.mermaid').length === 0) {
    errors.push(`${route}: expected at least one .mermaid patch diagram`);
  }

  if (doc.querySelectorAll('env-skew-panel').length === 0) {
    errors.push(`${route}: missing <env-skew-panel> visualizer`);
  }
}

const PATCH_DETAIL_ROUTE_SET = new Set<string>(
  PATCH_STATES.map((p) => `/patches/${p.slug}/`),
);

function verifyPatchesHubRoute(doc: Document, errors: string[]): void {
  if (doc.getElementById('patch-guides-index')) {
    errors.push('/patches/: static #patch-guides-index must be suppressed');
  }
  for (const requiredId of [
    'two-modules-in-6-hp',
    'front-panel-control-reference',
    'timing-quick-reference',
    'hardware--technical-references',
  ]) {
    if (!doc.getElementById(requiredId)) {
      errors.push(`/patches/: missing expected reference heading #${requiredId}`);
    }
  }
  if (!doc.querySelector('env-skew-panel')) {
    errors.push('/patches/: missing <env-skew-panel> preview component');
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function routeToHtmlRelPath(route: string): string {
  const normalized = normalizeRoutePath(route);
  if (normalized === '/') {
    return 'index.html';
  }
  return `${normalized.slice(1)}index.html`;
}

function walkAllFiles(dirAbs: string, baseDir: string, out: string[]): void {
  if (!fs.existsSync(dirAbs)) {
    return;
  }
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const absPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(absPath, baseDir, out);
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, absPath).replaceAll('\\', '/'));
    }
  }
}

function resolveDistFile(distDir: string, sitePathname: string): string | null {
  const withoutQuery = (sitePathname.split('?')[0] ?? '').split('#')[0] ?? '';
  if (!withoutQuery.startsWith(`${SITE_BASE}/`)) {
    return null;
  }
  const rel = withoutQuery.slice(SITE_BASE.length + 1);
  return resolveSafeFileUnderRoot(distDir, rel);
}

/** Validate root README.md relative file links and live GitHub Pages links. */
export function verifyReadmeLinks(
  repoRoot: string,
  distDir: string,
  parsedDocs?: ReadonlyMap<string, { doc: Document }>,
): string[] {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return ['Missing root README.md'];
  }

  const raw = fs.readFileSync(readmePath, 'utf8');
  // Strip fenced code blocks and inline code spans before extracting Markdown/HTML links
  const stripped = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets: string[] = [];

  for (const match of stripped.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1]) targets.push(match[1]);
  }
  for (const match of stripped.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    if (match[1]) targets.push(match[1]);
  }

  const errors: string[] = [];
  const pagesOriginPrefix = `${SITE_ORIGIN}${SITE_BASE}`;

  for (const rawTarget of targets) {
    const target = rawTarget.trim();
    if (!target || target.startsWith('#') || /^(?:mailto|tel|data):/i.test(target)) {
      continue;
    }

    if (target.startsWith('http://') || target.startsWith('https://')) {
      if (target === pagesOriginPrefix || target.startsWith(`${pagesOriginPrefix}/`)) {
        const sitePath = target.slice(SITE_ORIGIN.length);
        const hashIdx = sitePath.indexOf('#');
        const pathname = hashIdx === -1 ? sitePath : sitePath.slice(0, hashIdx);
        const fragment = hashIdx === -1 ? '' : safeDecodeURIComponent(sitePath.slice(hashIdx + 1));
        const normalizedRoute = normalizeRoutePath(pathname);
        if (CANONICAL_ROUTE_SET.has(normalizedRoute)) {
          if (fragment && parsedDocs?.has(normalizedRoute)) {
            if (!parsedDocs.get(normalizedRoute)?.doc.getElementById(fragment)) {
              errors.push(`README.md: broken Pages section anchor (${target})`);
            }
          }
          continue;
        }
        if (resolveDistFile(distDir, pathname)) {
          continue;
        }
        errors.push(`README.md: broken GitHub Pages link (${target})`);
      }
      continue;
    }

    const cleanRel = (target.split('#')[0] ?? '').split('?')[0] ?? '';
    if (!cleanRel) continue;
    const absTarget = path.resolve(repoRoot, cleanRel);
    const relFromRoot = path.relative(path.resolve(repoRoot), absTarget);
    if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot) || !fs.existsSync(absTarget)) {
      errors.push(`README.md: broken relative link (${target})`);
    }
  }

  return errors;
}

function checkMermaidSource(sourceLabel: string, diagramSource: string, errors: string[]): void {
  if (MERMAID_HEX_STYLE_RE.test(diagramSource)) {
    errors.push(`${sourceLabel}: Mermaid diagram contains disallowed inline hex styling`);
  }
  if (hasMixedLrSubgraphCrossEdges(diagramSource)) {
    errors.push(
      `${sourceLabel}: Mermaid diagram mixes flowchart LR with non-LR subgraph cross-edges`,
    );
  }
}

type ChecklistDetailMeta = (typeof BUILD_CHECKLISTS_CATALOG)[number];

function verifyStaticPassthroughs(distDir: string, repoRoot: string, errors: string[]): number {
  let verifiedPassthroughs = 0;
  for (const relPath of resolvePassthroughFiles(repoRoot)) {
    const distFile = path.join(distDir, relPath);
    if (!fs.existsSync(distFile) || !fs.statSync(distFile).isFile()) {
      errors.push(`Missing Static Passthrough in dist: ${relPath}`);
      continue;
    }
    verifiedPassthroughs += 1;
    if (relPath !== 'bom/ibom.html') {
      continue;
    }
    const srcBuf = fs.readFileSync(path.join(repoRoot, relPath));
    const distBuf = fs.readFileSync(distFile);
    if (Buffer.compare(srcBuf, distBuf) !== 0) {
      errors.push('Static Passthrough bom/ibom.html is not byte-for-byte identical to source');
    }
  }
  return verifiedPassthroughs;
}

function verifyDistAssetsAndFonts(distDir: string, errors: string[]): void {
  const allDistFiles: string[] = [];
  walkAllFiles(distDir, distDir, allDistFiles);
  const woff2Basenames: string[] = [];

  for (const relFile of allDistFiles) {
    if (isExcludedRepoPath(relFile)) {
      errors.push(`Leaked excluded file in dist: ${relFile}`);
    }
    if (relFile.startsWith('pagefind/')) {
      continue;
    }
    const lowerRel = relFile.toLowerCase();
    if (lowerRel.endsWith('.woff2')) {
      woff2Basenames.push(path.posix.basename(lowerRel));
      continue;
    }
    if (!lowerRel.endsWith('.html') && !lowerRel.endsWith('.css') && !lowerRel.endsWith('.js')) {
      continue;
    }
    const text = fs.readFileSync(path.join(distDir, relFile), 'utf8');
    const lowerText = text.toLowerCase();
    for (const domain of EXTERNAL_CDN_DOMAINS) {
      if (lowerText.includes(domain)) {
        errors.push(`Disallowed external CDN domain (${domain}) in built asset: ${relFile}`);
      }
    }
    if (lowerRel.endsWith('.css') && /https?:\/\//i.test(text)) {
      errors.push(`Disallowed http/https URL in built CSS: ${relFile}`);
    }
  }

  for (const family of REQUIRED_FONT_FAMILIES) {
    if (!woff2Basenames.some((name) => name.includes(family))) {
      errors.push(`Missing required self-hosted .woff2 font family in dist: ${family}`);
    }
  }
}

function verifyRouteChromeAndScripts(route: string, doc: Document, errors: string[]): void {
  const colorSchemeMeta = doc.querySelector('meta[name="color-scheme"]');
  if (colorSchemeMeta?.getAttribute('content') !== 'dark') {
    errors.push(`${route}: expected <meta name="color-scheme" content="dark">`);
  }

  if (!doc.querySelector('main[data-pagefind-body]')) {
    errors.push(`${route}: missing <main data-pagefind-body>`);
  }

  const h1Count = doc.querySelectorAll('h1').length;
  if (h1Count !== 1) {
    errors.push(`${route}: expected exactly 1 <h1>, found ${h1Count}`);
  }

  for (const selector of [
    'header.site-header',
    'dialog#mobile-nav-drawer',
    'footer.site-footer',
    'dialog#site-search-dialog',
  ]) {
    const el = doc.querySelector(selector);
    if (!el) {
      errors.push(`${route}: missing required chrome element ${selector}`);
    } else if (!el.hasAttribute('data-pagefind-ignore')) {
      errors.push(`${route}: ${selector} missing explicit data-pagefind-ignore`);
    }
  }

  for (const dialog of doc.querySelectorAll('dialog')) {
    if (dialog.getAttribute('closedby') !== 'any') {
      const idSuffix = dialog.id ? `#${dialog.id}` : '';
      errors.push(`${route}: dialog${idSuffix} missing closedby="any"`);
    }
  }

  const searchTriggers = [...doc.querySelectorAll('[data-search-trigger]')];
  if (searchTriggers.length === 0) {
    errors.push(`${route}: missing [data-search-trigger] button`);
  } else {
    for (const trigger of searchTriggers) {
      if (
        trigger.getAttribute('aria-haspopup') !== 'dialog' ||
        trigger.getAttribute('aria-controls') !== 'site-search-dialog'
      ) {
        errors.push(
          `${route}: [data-search-trigger] missing aria-haspopup="dialog" or aria-controls="site-search-dialog"`,
        );
      }
    }
  }

  if (doc.querySelectorAll('main script').length > 0) {
    errors.push(`${route}: unexpected inline/page <script> inside <main>`);
  }

  for (const script of doc.querySelectorAll('script:not([src])')) {
    const inlineCode = script.textContent ?? '';
    if (/^\s*import\s+/m.test(inlineCode)) {
      errors.push(
        `${route}: unbundled ESM import in inline <script> (wrap inside <Fragment slot="scripts"> so Vite bundles it)`,
      );
    }
  }

  for (const el of doc.querySelectorAll('script[src], link[href]')) {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const ref = el.getAttribute(attr)?.trim() ?? '';
    if (!/^(?:https?:)?\/\//i.test(ref)) {
      continue;
    }
    const isCanonicalLink =
      el.tagName.toLowerCase() === 'link' &&
      (el.getAttribute('rel') ?? '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .includes('canonical');
    if (isCanonicalLink && ref.startsWith(`${SITE_ORIGIN}${SITE_BASE}/`)) {
      continue;
    }
    errors.push(`${route}: disallowed third-party asset reference (${ref})`);
  }
}

function verifyRouteImages(route: string, doc: Document, distDir: string, errors: string[]): number {
  let verifiedImages = 0;
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src')?.trim() ?? '';
    const width = img.getAttribute('width')?.trim() ?? '';
    const height = img.getAttribute('height')?.trim() ?? '';
    if (!POSITIVE_INT_RE.test(width) || !POSITIVE_INT_RE.test(height)) {
      errors.push(`${route}: <img> missing explicit positive integer width/height (${src || 'unnamed'})`);
    }

    const fetchPriority = img.getAttribute('fetchpriority')?.trim().toLowerCase() ?? '';
    const loading = img.getAttribute('loading')?.trim().toLowerCase() ?? '';
    if (fetchPriority === 'high' && loading === 'lazy') {
      errors.push(
        `${route}: <img> cannot combine fetchpriority="high" with loading="lazy" (${src || 'unnamed'})`,
      );
    }

    if (!src || !resolveDistFile(distDir, src)) {
      errors.push(`${route}: <img> src does not resolve inside dist (${src || 'empty'})`);
    } else {
      verifiedImages += 1;
    }
  }
  return verifiedImages;
}

function verifyRouteLinks(
  route: string,
  doc: Document,
  distDir: string,
  implementedSet: ReadonlySet<string>,
  parsedDocs: ReadonlyMap<string, { doc: Document }>,
  errors: string[],
): number {
  let verifiedLinks = 0;
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (!href) {
      errors.push(`${route}: empty <a href>`);
      continue;
    }
    if (EXTERNAL_PROTO_RE.test(href)) {
      verifiedLinks += 1;
      continue;
    }
    if (href.startsWith('#')) {
      const fragment = safeDecodeURIComponent(href.slice(1));
      if (!fragment || !doc.getElementById(fragment)) {
        errors.push(`${route}: broken in-page fragment anchor ${href}`);
      } else {
        verifiedLinks += 1;
      }
      continue;
    }

    if (href !== SITE_BASE && !href.startsWith(`${SITE_BASE}/`)) {
      errors.push(`${route}: internal link missing ${SITE_BASE}/ prefix (${href})`);
      continue;
    }

    const hashIdx = href.indexOf('#');
    const pathname = hashIdx === -1 ? href : href.slice(0, hashIdx);
    const fragment = hashIdx === -1 ? '' : safeDecodeURIComponent(href.slice(hashIdx + 1));
    const normalizedTarget = normalizeRoutePath(pathname);

    if (CANONICAL_ROUTE_SET.has(normalizedTarget)) {
      if (fragment && implementedSet.has(normalizedTarget)) {
        const targetDoc = parsedDocs.get(normalizedTarget)?.doc;
        if (!targetDoc?.getElementById(fragment)) {
          errors.push(`${route}: broken cross-page anchor ${href}`);
          continue;
        }
      }
      verifiedLinks += 1;
      continue;
    }

    if (!resolveDistFile(distDir, pathname)) {
      errors.push(`${route}: internal link targets unknown route or missing file (${href})`);
      continue;
    }
    verifiedLinks += 1;
  }
  return verifiedLinks;
}

function verifyBuildHubRoute(doc: Document, errors: string[]): void {
  if (doc.getElementById('workflow-order')) {
    errors.push('/build/: redundant ## Workflow Order heading must be suppressed');
  }
  if (doc.querySelectorAll('[data-hub-step]').length !== 6) {
    errors.push('/build/: expected 6 workflow step cards');
  }
  if (!doc.querySelector('progress[data-hub-total-progress]')) {
    errors.push('/build/: missing native <progress> aggregate bar');
  }
  if (!doc.querySelector(`a[href="${SITE_BASE}/downloads/"]`)) {
    errors.push('/build/: missing /downloads/ companion or hub link');
  }
}

function verifyChecklistDetailRoute(
  route: string,
  doc: Document,
  checklistMeta: ChecklistDetailMeta,
  errors: string[],
): void {
  if (!doc.querySelector('progress[data-checklist-progress]')) {
    errors.push(`${route}: missing native <progress data-checklist-progress> element`);
  }
  if (checklistMeta.slug === '05-board-bringup' && !doc.querySelector('.bringup-jump-strip a')) {
    errors.push(`${route}: missing bench jump strip (.bringup-jump-strip)`);
  }
  const cbs = [...doc.querySelectorAll<HTMLInputElement>('[data-checklist-checkbox]')];
  if (cbs.length !== checklistMeta.totalItems) {
    errors.push(
      `${route}: expected ${checklistMeta.totalItems} interactive checkboxes, found ${cbs.length}`,
    );
  }
  const ids = new Set<string>();
  for (const cb of cbs) {
    if (cb.disabled || cb.checked || cb.hasAttribute('checked')) {
      errors.push(`${route}: checklist checkbox must start enabled and unchecked`);
      break;
    }
    const id = cb.getAttribute('data-item-id') ?? '';
    if (!id || ids.has(id)) {
      errors.push(`${route}: duplicate or missing data-item-id (${id})`);
      break;
    }
    ids.add(id);
  }
  const imgBtns = doc.querySelectorAll('button.lightbox-trigger[data-lightbox-src]').length;
  if (imgBtns !== checklistMeta.imageCount) {
    errors.push(
      `${route}: expected ${checklistMeta.imageCount} lightbox image triggers, found ${imgBtns}`,
    );
  }
}

function verifyBuildIbomLinks(route: string, doc: Document, errors: string[]): void {
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (
      href.endsWith('/bom/ibom.html') &&
      !link.hasAttribute('download') &&
      link.getAttribute('target') !== '_blank'
    ) {
      errors.push(`${route}: bom/ibom.html launch link must carry target="_blank"`);
    }
  }
}

function verifyOriginRoute(doc: Document, errors: string[]): void {
  if (!doc.querySelector('[data-origin-lightbox][data-lightbox-src]')) {
    errors.push('/origin/: missing EnvelopeFollower.webp lightbox trigger');
  }
}

function verifyDownloadsRoute(doc: Document, errors: string[]): void {
  const ibom = doc.querySelector<HTMLAnchorElement>('a[href$="/bom/ibom.html"]:not([download])');
  if (!ibom || ibom.getAttribute('target') !== '_blank') {
    errors.push('/downloads/: Interactive BOM launcher link must carry target="_blank"');
  }
  const pdfLink = doc.querySelector<HTMLAnchorElement>('a[href$="/envelope_follower.pdf"]');
  if (!pdfLink) {
    errors.push('/downloads/: missing envelope_follower.pdf link');
  }
}

function verifyHardwareRoute(doc: Document, errors: string[]): void {
  for (const id of ['overview', 'schematic', 'pcb', 'panel']) {
    if (!doc.getElementById(id)) {
      errors.push(`/hardware/: missing section anchor #${id}`);
    }
  }
  if (doc.querySelectorAll('.mermaid').length === 0) {
    errors.push('/hardware/: missing .mermaid Signal Flow diagram in #overview');
  }
  if (!doc.querySelector('zoom-pan-viewer')) {
    errors.push('/hardware/: missing <zoom-pan-viewer> schematic stage');
  }
  if (!doc.querySelector('panel-layer-inspector')) {
    errors.push('/hardware/: missing <panel-layer-inspector> stage in #panel');
  }
}

function verifyRouteSpecificContracts(
  route: string,
  doc: Document,
  distDir: string,
  errors: string[],
): void {
  for (const pre of doc.querySelectorAll('pre.mermaid')) {
    checkMermaidSource(`${route} (<pre class="mermaid">)`, pre.textContent ?? '', errors);
  }

  if (NON_MERMAID_ROUTES.has(route)) {
    verifyNoMermaidOnRoute(route, doc, distDir, errors);
  }
  if (REFERENCE_SPEC_DETAIL_ROUTES.has(route)) {
    verifyReferenceSpecRoute(route, doc, errors);
  }
  if (route === '/patches/') {
    verifyPatchesHubRoute(doc, errors);
  }
  if (PATCH_DETAIL_ROUTE_SET.has(route)) {
    verifyPatchGuideDetailRoute(route, doc, errors);
  }
  if (route === '/build/') {
    verifyBuildHubRoute(doc, errors);
  }
  const checklistMeta = CHECKLIST_DETAIL_META_BY_ROUTE.get(route);
  if (checklistMeta) {
    verifyChecklistDetailRoute(route, doc, checklistMeta, errors);
  }
  if (route === '/origin/') {
    verifyOriginRoute(doc, errors);
  }
  if (route === '/downloads/') {
    verifyDownloadsRoute(doc, errors);
  }
  if (route === '/build/' || checklistMeta) {
    verifyBuildIbomLinks(route, doc, errors);
  }
  if (route === '/hardware/') {
    verifyHardwareRoute(doc, errors);
  }
}

function verifyPatchStateParity(errors: string[]): void {
  const expectedPatchSlugs = PATCH_GUIDE_FILES.filter((f) => f !== 'patches/README.md').map((f) =>
    path.posix.basename(f, '.md'),
  );
  const actualPatchSlugs = PATCH_STATES.map((p) => p.slug);
  if (JSON.stringify(actualPatchSlugs) !== JSON.stringify(expectedPatchSlugs)) {
    errors.push(
      `patch-states sidecar slug mismatch: expected ${expectedPatchSlugs.join(', ')}, got ${actualPatchSlugs.join(', ')}`,
    );
  }
  errors.push(...validatePatchStates(PATCH_STATES));
}

function verifyAggregateChecklistTotals(
  implementedSet: ReadonlySet<string>,
  parsedDocs: ReadonlyMap<string, { doc: Document }>,
  errors: string[],
): void {
  if (!BUILD_CHECKLISTS_CATALOG.every((c) => implementedSet.has(c.route))) {
    return;
  }
  let totalCheckboxes = 0;
  let totalImages = 0;
  for (const c of BUILD_CHECKLISTS_CATALOG) {
    const entry = parsedDocs.get(c.route);
    if (!entry) continue;
    totalCheckboxes += entry.doc.querySelectorAll('[data-checklist-checkbox]').length;
    totalImages += entry.doc.querySelectorAll('button.lightbox-trigger[data-lightbox-src]').length;
  }
  if (totalCheckboxes !== TOTAL_CHECKLIST_ITEMS) {
    errors.push(
      `build checklists: aggregate checkbox count mismatch (expected ${TOTAL_CHECKLIST_ITEMS}, got ${totalCheckboxes})`,
    );
  }
  if (totalImages !== 81) {
    errors.push(`build checklists: expected 81 image lightboxes total, got ${totalImages}`);
  }
}

function verifyPagefindArtifacts(distDir: string, errors: string[]): void {
  const pfScript = path.join(distDir, 'pagefind/pagefind.js');
  const pfEntry = path.join(distDir, 'pagefind/pagefind-entry.json');
  if (!fs.existsSync(pfScript) || fs.statSync(pfScript).size === 0) {
    errors.push('Missing Pagefind runtime bundle: dist/pagefind/pagefind.js');
  }
  if (!fs.existsSync(pfEntry) || fs.statSync(pfEntry).size === 0) {
    errors.push('Missing Pagefind search entry metadata: dist/pagefind/pagefind-entry.json');
  }
}

function verifyMarkdownMermaidSources(repoRoot: string, errors: string[]): void {
  for (const relMd of ALLOWLISTED_MARKDOWN_FILES) {
    const absMd = path.join(repoRoot, relMd);
    if (!fs.existsSync(absMd) || !fs.statSync(absMd).isFile()) {
      continue;
    }
    const mdText = fs.readFileSync(absMd, 'utf8').replace(/\r\n/g, '\n');
    for (const match of mdText.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)) {
      checkMermaidSource(relMd, match[1] ?? '', errors);
    }
  }
}

/** Verify built Astro output against static artifact, passthrough, and HTML invariants. */
export function verifyBuiltSite(options: VerifyBuiltSiteOptions): SiteContractResult {
  const distDir = path.resolve(options.distDir);
  const repoRoot = path.resolve(options.repoRoot);
  const implementedRoutes = (options.implementedRoutes ?? CANONICAL_ROUTES).map(normalizeRoutePath);
  const implementedSet = new Set<string>(implementedRoutes);

  const errors: string[] = [];
  let verifiedImages = 0;
  let verifiedLinks = 0;

  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    return {
      checkedHtmlRoutes: [],
      verifiedPassthroughs: 0,
      verifiedImages: 0,
      verifiedLinks: 0,
      errors: [`Missing build output directory: ${distDir}`],
    };
  }

  const verifiedPassthroughs = verifyStaticPassthroughs(distDir, repoRoot, errors);
  verifyDistAssetsAndFonts(distDir, errors);

  const parsedDocs = new Map<string, { win: Window; doc: Document }>();
  const checkedHtmlRoutes: string[] = [];

  try {
    for (const route of implementedRoutes) {
      const htmlRel = routeToHtmlRelPath(route);
      const htmlPath = path.join(distDir, htmlRel);
      if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
        errors.push(`Missing expected route HTML in dist: ${route} (${htmlRel})`);
        continue;
      }

      const html = fs.readFileSync(htmlPath, 'utf8');
      const win = new Window();
      win.document.documentElement.innerHTML = html;
      parsedDocs.set(route, { win, doc: win.document as unknown as Document });
      checkedHtmlRoutes.push(route);
    }

    for (const [route, { doc }] of parsedDocs) {
      verifyRouteChromeAndScripts(route, doc, errors);
      verifiedImages += verifyRouteImages(route, doc, distDir, errors);
      verifiedLinks += verifyRouteLinks(route, doc, distDir, implementedSet, parsedDocs, errors);
      verifyRouteSpecificContracts(route, doc, distDir, errors);
    }

    verifyPatchStateParity(errors);
    verifyAggregateChecklistTotals(implementedSet, parsedDocs, errors);

    if (options.requirePagefind) {
      verifyPagefindArtifacts(distDir, errors);
    }
    if (options.verifyReadme) {
      errors.push(...verifyReadmeLinks(repoRoot, distDir, parsedDocs));
    }
    verifyMarkdownMermaidSources(repoRoot, errors);
  } finally {
    for (const { win } of parsedDocs.values()) {
      win.close();
    }
  }

  return {
    checkedHtmlRoutes,
    verifiedPassthroughs,
    verifiedImages,
    verifiedLinks,
    errors,
  };
}
