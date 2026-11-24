import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import {
  BUILD_CHECKLISTS_CATALOG,
  TOTAL_CHECKLIST_ITEMS,
} from '../data/build-checklists.ts';
import { PATCH_STATES, validatePatchStates } from '../data/patch-states.ts';
import { PATCH_GUIDE_FILES, REFERENCE_SPECS_CATALOG } from './content-manifest.ts';
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

/** Verify built Astro output against static artifact, passthrough, and HTML invariants. */
export function verifyBuiltSite(options: VerifyBuiltSiteOptions): SiteContractResult {
  const distDir = path.resolve(options.distDir);
  const repoRoot = path.resolve(options.repoRoot);
  const implementedRoutes = (options.implementedRoutes ?? CANONICAL_ROUTES).map(normalizeRoutePath);
  const implementedSet = new Set<string>(implementedRoutes);

  const errors: string[] = [];
  let verifiedPassthroughs = 0;
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

  // 1. Verify all allowlisted Static Passthroughs exist and bom/ibom.html is byte-identical.
  const passthroughs = resolvePassthroughFiles(repoRoot);
  for (const relPath of passthroughs) {
    const distFile = path.join(distDir, relPath);
    if (!fs.existsSync(distFile) || !fs.statSync(distFile).isFile()) {
      errors.push(`Missing Static Passthrough in dist: ${relPath}`);
      continue;
    }
    verifiedPassthroughs += 1;
    if (relPath === 'bom/ibom.html') {
      const srcBuf = fs.readFileSync(path.join(repoRoot, relPath));
      const distBuf = fs.readFileSync(distFile);
      if (Buffer.compare(srcBuf, distBuf) !== 0) {
        errors.push('Static Passthrough bom/ibom.html is not byte-for-byte identical to source');
      }
    }
  }

  // 2. Scan distDir for any leaked excluded repository files.
  const allDistFiles: string[] = [];
  walkAllFiles(distDir, distDir, allDistFiles);
  for (const relFile of allDistFiles) {
    if (isExcludedRepoPath(relFile)) {
      errors.push(`Leaked excluded file in dist: ${relFile}`);
    }
  }

  // 3. Parse all implemented HTML routes.
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

    // 4. Validate HTML invariants, third-party asset absence, images, and links per route.
    for (const [route, { doc }] of parsedDocs) {
      const colorSchemeMeta = doc.querySelector('meta[name="color-scheme"]');
      if (colorSchemeMeta?.getAttribute('content') !== 'dark') {
        errors.push(`${route}: expected <meta name="color-scheme" content="dark">`);
      }

      if (!doc.querySelector('main[data-pagefind-body]')) {
        errors.push(`${route}: missing <main data-pagefind-body>`);
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
        if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//')) {
          errors.push(`${route}: disallowed third-party asset reference (${ref})`);
        }
      }

      for (const img of doc.querySelectorAll('img')) {
        const src = img.getAttribute('src')?.trim() ?? '';
        const width = img.getAttribute('width')?.trim() ?? '';
        const height = img.getAttribute('height')?.trim() ?? '';
        if (!POSITIVE_INT_RE.test(width) || !POSITIVE_INT_RE.test(height)) {
          errors.push(`${route}: <img> missing explicit positive integer width/height (${src || 'unnamed'})`);
        }

        if (!src || !resolveDistFile(distDir, src)) {
          errors.push(`${route}: <img> src does not resolve inside dist (${src || 'empty'})`);
        } else {
          verifiedImages += 1;
        }
      }

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

        const fileTarget = resolveDistFile(distDir, pathname);
        if (!fileTarget) {
          errors.push(`${route}: internal link targets unknown route or missing file (${href})`);
          continue;
        }
        verifiedLinks += 1;
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
        if (doc.getElementById('workflow-order')) {
          errors.push('/build/: redundant ## Workflow Order heading must be suppressed');
        }
        if (doc.querySelectorAll('[data-hub-step]').length !== 6) {
          errors.push('/build/: expected 6 workflow step cards');
        }
      }
      const checklistMeta = CHECKLIST_DETAIL_META_BY_ROUTE.get(route);
      if (checklistMeta) {
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
      if (route === '/origin/') {
        if (!doc.querySelector('[data-origin-lightbox][data-lightbox-src]')) {
          errors.push('/origin/: missing EnvelopeFollower.webp lightbox trigger');
        }
      }
      if (route === '/downloads/') {
        const ibom = doc.querySelector<HTMLAnchorElement>('a[href$="/bom/ibom.html"]:not([download])');
        if (!ibom || ibom.getAttribute('target') !== '_blank') {
          errors.push('/downloads/: Interactive BOM launcher link must carry target="_blank"');
        }
        const pdfLink = doc.querySelector<HTMLAnchorElement>('a[href$="/envelope_follower.pdf"]');
        if (!pdfLink) {
          errors.push('/downloads/: missing envelope_follower.pdf link');
        }
      }
      if (route === '/build/' || checklistMeta) {
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
      if (route === '/hardware/') {
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
    }

    // 5. Verify patch-state sidecar parity and bounds.
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

    // 6. Verify aggregate checklist checkbox and photo totals when all 6 checklist pages are checked.
    if (BUILD_CHECKLISTS_CATALOG.every((c) => implementedSet.has(c.route))) {
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

    // 7. Verify Pagefind search artifacts when enabled.
    if (options.requirePagefind) {
      const pfScript = path.join(distDir, 'pagefind/pagefind.js');
      const pfEntry = path.join(distDir, 'pagefind/pagefind-entry.json');
      if (!fs.existsSync(pfScript) || fs.statSync(pfScript).size === 0) {
        errors.push('Missing Pagefind runtime bundle: dist/pagefind/pagefind.js');
      }
      if (!fs.existsSync(pfEntry) || fs.statSync(pfEntry).size === 0) {
        errors.push('Missing Pagefind search entry metadata: dist/pagefind/pagefind-entry.json');
      }
    }

    // 8. Verify root README.md relative paths and live GitHub Pages links when enabled.
    if (options.verifyReadme) {
      errors.push(...verifyReadmeLinks(repoRoot, distDir, parsedDocs));
    }
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
