import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { CANONICAL_ROUTES, SITE_BASE, normalizeRoutePath } from './routes.ts';
import { isExcludedRepoPath, resolvePassthroughFiles } from './static-passthrough.ts';

/** Configuration options for Seam 1 built-site artifact verification. */
export interface VerifyBuiltSiteOptions {
  distDir: string;
  repoRoot: string;
  implementedRoutes?: readonly string[];
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
  if (!rel || rel.includes('..') || rel.includes('\0')) {
    return null;
  }
  const resolvedDist = path.resolve(distDir);
  const candidate = path.resolve(resolvedDist, rel);
  const relCheck = path.relative(resolvedDist, candidate);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return null;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

/** Verify built Astro output against Seam 1 static artifact, passthrough, and HTML invariants. */
export function verifyBuiltSite(options: VerifyBuiltSiteOptions): SiteContractResult {
  const distDir = path.resolve(options.distDir);
  const repoRoot = path.resolve(options.repoRoot);
  const implementedRoutes = (options.implementedRoutes ?? ['/']).map(normalizeRoutePath);
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
