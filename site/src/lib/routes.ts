/** Canonical GitHub Pages origin for ENV / SKEW. */
export const SITE_ORIGIN = 'https://domesticmouse.github.io';

/** Canonical GitHub Pages repository base path (no trailing slash). */
export const SITE_BASE = '/EnvelopeFollowerWithSkewLimiter';

/** Full canonical site URL including trailing slash. */
export const SITE_URL = `${SITE_ORIGIN}${SITE_BASE}/`;

/** Public GitHub repository URL. */
export const GITHUB_REPO_URL =
  'https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter';

/** Audience-ordered top-level navigation descriptor. */
export interface NavItem {
  label: string;
  href: string;
}

/** Five audience-ordered top-level navigation links required across site chrome. */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Patches', href: '/patches/' },
  { label: 'Build', href: '/build/' },
  { label: 'Hardware', href: '/hardware/' },
  { label: 'Origin', href: '/origin/' },
  { label: 'Downloads', href: '/downloads/' },
];

/** Complete canonical 25-route HTML map beneath SITE_BASE. */
export const CANONICAL_ROUTES: readonly string[] = [
  '/',
  '/hardware/',
  '/origin/',
  '/downloads/',
  '/specs/',
  '/specs/design-spec/',
  '/specs/base-circuit/',
  '/specs/circuit-review/',
  '/specs/panel-svg-spec/',
  '/patches/',
  '/patches/01-sidechain-ducking/',
  '/patches/02-auto-wah-envelope-filter/',
  '/patches/03-compression-expansion-gating/',
  '/patches/04-ducking-and-blooming-fx/',
  '/patches/05-cross-modulation-push-pull/',
  '/patches/06-audio-rate-slew-waveshaping/',
  '/patches/07-asymmetric-portamento-slides/',
  '/patches/08-gate-to-ar-envelope-and-slewed-mod/',
  '/build/',
  '/build/01-main-board-ordering/',
  '/build/01b-front-panel-ordering/',
  '/build/02-pcba-part-alignment/',
  '/build/03-tayda-ordering/',
  '/build/04-hand-assembly/',
  '/build/05-board-bringup/',
];

/** Prefix an internal site route or passthrough asset path with SITE_BASE, preserving hashes. */
export function withBase(path: string): string {
  if (!path || path === '/') {
    return `${SITE_BASE}/`;
  }
  if (path.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }

  const hashIndex = path.indexOf('#');
  const rawPathname = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hashSuffix = hashIndex === -1 ? '' : path.slice(hashIndex);

  const leadingSlashPath = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
  if (leadingSlashPath === SITE_BASE || leadingSlashPath.startsWith(`${SITE_BASE}/`)) {
    return `${leadingSlashPath}${hashSuffix}`;
  }

  return `${SITE_BASE}${leadingSlashPath}${hashSuffix}`;
}

/** Normalize a URL pathname (with or without SITE_BASE, query, or hash) to a canonical route key. */
export function normalizeRoutePath(rawPath: string): string {
  const withoutHash = rawPath.split('#')[0] ?? '/';
  const withoutQuery = withoutHash.split('?')[0] ?? '/';
  let pathname = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;

  if (pathname === SITE_BASE) {
    pathname = '/';
  } else if (pathname.startsWith(`${SITE_BASE}/`)) {
    pathname = pathname.slice(SITE_BASE.length);
  }

  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'index.html'.length);
  }

  if (pathname === '' || pathname === '/') {
    return '/';
  }

  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** Return true when currentPath belongs to the given top-level navigation section. */
export function isNavSectionActive(currentPath: string, navHref: string): boolean {
  const normalizedCurrent = normalizeRoutePath(currentPath);
  const normalizedNav = normalizeRoutePath(navHref);

  if (normalizedNav === '/') {
    return normalizedCurrent === '/';
  }

  return normalizedCurrent === normalizedNav || normalizedCurrent.startsWith(normalizedNav);
}
