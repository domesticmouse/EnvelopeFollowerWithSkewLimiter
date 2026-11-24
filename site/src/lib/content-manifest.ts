import path from 'node:path';
import { GITHUB_REPO_URL, SITE_BASE, withBase } from './routes.ts';
import { REQUIRED_PASSTHROUGH_FILES, isExcludedRepoPath, toPosixPath } from './static-passthrough.ts';

/** Four engineering & mechanical Reference Specs at repository root. */
export const REFERENCE_SPEC_FILES = [
  'DesignSpec.md',
  'EnvelopeFollower.md',
  'EnvelopeFollowerImprovements.md',
  'panel_svg_spec.md',
] as const;

/** Seven Build Checklists Markdown files (hub + six bench checklists). */
export const BUILD_CHECKLIST_FILES = [
  'checklists/README.md',
  'checklists/01-main-board-ordering.md',
  'checklists/01b-front-panel-ordering.md',
  'checklists/02-pcba-part-alignment.md',
  'checklists/03-tayda-ordering.md',
  'checklists/04-hand-assembly.md',
  'checklists/05-board-bringup.md',
] as const;

/** Nine Patch Guides Markdown files (hub + eight patches). */
export const PATCH_GUIDE_FILES = [
  'patches/README.md',
  'patches/01-sidechain-ducking.md',
  'patches/02-auto-wah-envelope-filter.md',
  'patches/03-compression-expansion-gating.md',
  'patches/04-ducking-and-blooming-fx.md',
  'patches/05-cross-modulation-push-pull.md',
  'patches/06-audio-rate-slew-waveshaping.md',
  'patches/07-asymmetric-portamento-slides.md',
  'patches/08-gate-to-ar-envelope-and-slewed-mod.md',
] as const;

/** Strictly the 20 allowlisted single-source Markdown files ingested from repository root. */
export const ALLOWLISTED_MARKDOWN_FILES: readonly string[] = [
  ...REFERENCE_SPEC_FILES,
  ...BUILD_CHECKLIST_FILES,
  ...PATCH_GUIDE_FILES,
];

/** Visual-companion destination link shown in the subtle top banner of a Reference Spec. */
export interface CompanionLink {
  label: string;
  href: string;
}

/** Ordered metadata entry for one Reference Spec page and the /specs/ index. */
export interface ReferenceSpecMeta {
  num: string;
  slug: 'base-circuit' | 'circuit-review' | 'design-spec' | 'panel-svg-spec';
  sourceFile: (typeof REFERENCE_SPEC_FILES)[number];
  route: `/specs/${string}/`;
  shortTitle: string;
  fullTitle: string;
  stageLabel: string;
  summary: string;
  metrics: readonly string[];
  companionPrompt: string;
  companionLinks: readonly CompanionLink[];
}

/**
 * Four Reference Specs ordered along the engineering evolution & mechanical lineage:
 * Base Circuit (01) -> Circuit Review (02) -> Final Design Spec (03) -> Panel SVG Spec (04).
 */
export const REFERENCE_SPECS_CATALOG: readonly ReferenceSpecMeta[] = [
  {
    num: '01',
    slug: 'base-circuit',
    sourceFile: 'EnvelopeFollower.md',
    route: '/specs/base-circuit/',
    shortTitle: 'Base Circuit Spec',
    fullTitle: 'Envelope Follower Circuit Specification',
    stageLabel: 'Baseline Analysis · HAGIWO No. 43 Extraction',
    summary:
      'Complete 6-op-amp circuit extraction from HAGIWO/ハギヲ’s Jan 2022 schematic: stage-by-stage transfer functions, 41-part BOM, and 30-net pinlist.',
    metrics: ['6 op-amps', '41 parts', '30 nets', '4 display equations'],
    companionPrompt:
      'Visual companion: Inspect the framed original HAGIWO schematic plate and provenance narrative.',
    companionLinks: [{ label: 'Open Origin Story →', href: '/origin/' }],
  },
  {
    num: '02',
    slug: 'circuit-review',
    sourceFile: 'EnvelopeFollowerImprovements.md',
    route: '/specs/circuit-review/',
    shortTitle: 'Circuit Review',
    fullTitle: 'Envelope Follower Circuit Review & Improvement Recommendations',
    stageLabel: 'Tier 1–3 Engineering Critique',
    summary:
      'Electrical engineering audit uncovering five Tier-1 flaws (divider collapse, D3 drop, OFFSET loading, input impedance, idle LED leak) and the Active Skew Limiter fix.',
    metrics: ['5 Tier-1 fixes', '3 architectures compared', '3 display equations'],
    companionPrompt:
      'Visual companion: Compare HAGIWO No. 43 vs. ENV / SKEW evolution and inspect the final schematic.',
    companionLinks: [
      { label: 'Origin Comparison →', href: '/origin/' },
      { label: 'Schematic Stage →', href: '/hardware/#schematic' },
    ],
  },
  {
    num: '03',
    slug: 'design-spec',
    sourceFile: 'DesignSpec.md',
    route: '/specs/design-spec/',
    shortTitle: 'Final Design Spec',
    fullTitle: 'Envelope Follower with Skew Limiter — Final Design Specification',
    stageLabel: 'Locked Production Architecture',
    summary:
      'Authoritative 2× TL074HIDR (8/8 sections, 0 trimmers) specification: 80-footprint BOM, FAST/SLOW timing tables, split-R SMOOTH filter, and 48-net pinlist.',
    metrics: ['80 footprints', '48 nets', '0 trimmers', '±12 V (~13 mA)'],
    companionPrompt:
      'Visual companion: Explore the 9-block A3 schematic, F.Cu/B.Cu PCB plates, and architecture diagram.',
    companionLinks: [
      { label: 'Hardware Showcase →', href: '/hardware/' },
      { label: '9-Block Schematic →', href: '/hardware/#schematic' },
    ],
  },
  {
    num: '04',
    slug: 'panel-svg-spec',
    sourceFile: 'panel_svg_spec.md',
    route: '/specs/panel-svg-spec/',
    shortTitle: 'Panel SVG Spec',
    fullTitle: 'Eurorack Front-Panel Specification — ENVELOPE FOLLOWER + SKEW LIMITER',
    stageLabel: '6 HP Mechanical & SVG Contract',
    summary:
      'Exact 1:1 mm canvas coordinates (30.00 × 128.50 mm), NPTH mounting slots, control drills/keepouts, B.SilkS rules, and collapsible §8 JSON geometry.',
    metrics: ['6 HP × 3U', '11 front controls', '§8 JSON geometry'],
    companionPrompt:
      'Visual companion: Toggle F.Mask, F.SilkS, and live §8 mechanical keepouts over the 6 HP panel.',
    companionLinks: [{ label: 'Interactive Panel Inspector →', href: '/hardware/#panel' }],
  },
];

/** Ordered left-rail navigation items for Reference Specs pages. */
export const REFERENCE_SPEC_NAV_ITEMS: readonly {
  label: string;
  href: string;
  badge: string;
}[] = [
  { label: 'Overview', href: '/specs/', badge: '00' },
  ...REFERENCE_SPECS_CATALOG.map((spec) => ({
    label: spec.shortTitle,
    href: spec.route,
    badge: spec.num,
  })),
];

/** Canonical mapping from repository-relative Markdown paths and directory links to site routes. */
export const MD_TO_ROUTE: Readonly<Record<string, string>> = {
  'DesignSpec.md': '/specs/design-spec/',
  'EnvelopeFollower.md': '/specs/base-circuit/',
  'EnvelopeFollowerImprovements.md': '/specs/circuit-review/',
  'panel_svg_spec.md': '/specs/panel-svg-spec/',
  'checklists/README.md': '/build/',
  'checklists/': '/build/',
  checklists: '/build/',
  'checklists/01-main-board-ordering.md': '/build/01-main-board-ordering/',
  'checklists/01b-front-panel-ordering.md': '/build/01b-front-panel-ordering/',
  'checklists/02-pcba-part-alignment.md': '/build/02-pcba-part-alignment/',
  'checklists/03-tayda-ordering.md': '/build/03-tayda-ordering/',
  'checklists/04-hand-assembly.md': '/build/04-hand-assembly/',
  'checklists/05-board-bringup.md': '/build/05-board-bringup/',
  'patches/README.md': '/patches/',
  'patches/': '/patches/',
  patches: '/patches/',
  'patches/01-sidechain-ducking.md': '/patches/01-sidechain-ducking/',
  'patches/02-auto-wah-envelope-filter.md': '/patches/02-auto-wah-envelope-filter/',
  'patches/03-compression-expansion-gating.md': '/patches/03-compression-expansion-gating/',
  'patches/04-ducking-and-blooming-fx.md': '/patches/04-ducking-and-blooming-fx/',
  'patches/05-cross-modulation-push-pull.md': '/patches/05-cross-modulation-push-pull/',
  'patches/06-audio-rate-slew-waveshaping.md': '/patches/06-audio-rate-slew-waveshaping/',
  'patches/07-asymmetric-portamento-slides.md': '/patches/07-asymmetric-portamento-slides/',
  'patches/08-gate-to-ar-envelope-and-slewed-mod.md':
    '/patches/08-gate-to-ar-envelope-and-slewed-mod/',
  'panel_art/': '/hardware/#panel',
  panel_art: '/hardware/#panel',
};

const PASSTHROUGH_FILE_SET = new Set<string>(REQUIRED_PASSTHROUGH_FILES);
const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Resolve a relative asset or link path against sourceRepoPath (POSIX repo-relative). */
export function resolveRelativeRepoPath(rawPathname: string, sourceRepoPath: string): string {
  const normalizedSource = toPosixPath(sourceRepoPath);
  const sourceDir = normalizedSource ? path.posix.dirname(normalizedSource) : '.';

  const cleanedInput = rawPathname.replaceAll('\\', '/');
  if (cleanedInput.startsWith('/')) {
    return cleanedInput.replace(/^\/+/, '');
  }

  const joined = sourceDir === '.' ? cleanedInput : path.posix.join(sourceDir, cleanedInput);
  const normalized = path.posix.normalize(joined).replace(/^\.\//, '');
  if (cleanedInput.endsWith('/') && !normalized.endsWith('/')) {
    return `${normalized}/`;
  }
  return normalized;
}

/** Return true when a normalized repository-relative path belongs to Static Passthrough output. */
export function isAllowlistedPassthroughPath(repoRelPath: string): boolean {
  const normalized = toPosixPath(repoRelPath);
  if (isExcludedRepoPath(normalized)) {
    return false;
  }
  return PASSTHROUGH_FILE_SET.has(normalized) || normalized.startsWith('images/');
}

/**
 * Resolve any link href found inside single-source repository Markdown:
 * - Mapped .md / directory targets -> canonical site routes preserving #anchors
 * - Allowlisted Static Passthroughs (images/**, bom/ibom.html, PDF, ZIPs, CSVs, etc.) -> base-prefixed asset URL
 * - Non-site CAD/Python/repo files -> GitHub blob/main fallback URL
 */
export function resolveRepoHref(rawHref: string, sourceRepoPath: string): string {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#') || EXTERNAL_SCHEME_RE.test(trimmed)) {
    return trimmed;
  }

  const hashIdx = trimmed.indexOf('#');
  const withoutHash = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
  const hashSuffix = hashIdx === -1 ? '' : trimmed.slice(hashIdx);

  const queryIdx = withoutHash.indexOf('?');
  const rawPathname = queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx);
  const querySuffix = queryIdx === -1 ? '' : withoutHash.slice(queryIdx);

  if (!rawPathname) {
    return trimmed;
  }

  if (rawPathname === SITE_BASE || rawPathname.startsWith(`${SITE_BASE}/`)) {
    return `${rawPathname}${querySuffix}${hashSuffix}`;
  }

  const repoRelPath = resolveRelativeRepoPath(rawPathname, sourceRepoPath);
  const mappedRoute = MD_TO_ROUTE[repoRelPath];
  if (mappedRoute) {
    const routeBase = mappedRoute.split('#')[0] ?? mappedRoute;
    const routeHash = mappedRoute.includes('#') ? mappedRoute.slice(mappedRoute.indexOf('#')) : '';
    const finalHash = hashSuffix || routeHash;
    return `${withBase(routeBase)}${querySuffix}${finalHash}`;
  }

  if (isAllowlistedPassthroughPath(repoRelPath)) {
    return `${withBase(repoRelPath)}${querySuffix}${hashSuffix}`;
  }

  const gitKind = repoRelPath.endsWith('/') ? 'tree' : 'blob';
  const cleanGitPath = repoRelPath.replace(/\/+$/, '');
  return `${GITHUB_REPO_URL}/${gitKind}/main/${cleanGitPath}${querySuffix}${hashSuffix}`;
}

/** Strip inline Markdown punctuation from a heading line for clean plain-text page titles. */
function cleanMarkdownInlineText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive a document's page title strictly from its first H1 heading
 * so repository Markdown files remain 100% free of YAML frontmatter.
 */
export function extractDocumentTitle(
  markdownBody: string,
  headings?: readonly { depth: number; text: string }[],
): string {
  const firstH1 = headings?.find((h) => h.depth === 1);
  if (firstH1?.text.trim()) {
    return cleanMarkdownInlineText(firstH1.text);
  }

  const match = /^#\s+(.+)$/m.exec(markdownBody);
  if (match?.[1]) {
    return cleanMarkdownInlineText(match[1]);
  }

  return 'ENV / SKEW';
}

/** Return true if a Markdown document contains at least one ```mermaid fenced diagram block. */
export function hasMermaidFence(markdownBody: string): boolean {
  return /^```mermaid\b/m.test(markdownBody);
}
