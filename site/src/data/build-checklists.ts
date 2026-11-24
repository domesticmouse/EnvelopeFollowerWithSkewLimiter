import type { CompanionLink } from '../lib/content-manifest.ts';

/** Navigation item shape shared cleanly with DocLayout without .astro import in plain TS modules. */
export interface BuildNavItem {
  label: string;
  href: string;
  badge?: string;
  slug?: string;
}

/** Canonical route slugs for the 6 Build Checklist steps. */
export type ChecklistSlug =
  | '01-main-board-ordering'
  | '01b-front-panel-ordering'
  | '02-pcba-part-alignment'
  | '03-tayda-ordering'
  | '04-hand-assembly'
  | '05-board-bringup';

/** Metadata for one Build Checklist step and its /build/ card. */
export interface BuildChecklistMeta {
  num: string;
  slug: ChecklistSlug;
  sourceFile: `checklists/${string}.md`;
  route: `/build/${ChecklistSlug}/`;
  shortTitle: string;
  fullTitle: string;
  phaseLabel: string;
  summary: string;
  totalItems: number;
  imageCount: number;
  hasPlacementCards: boolean;
  showsJlcpcbStrip: boolean;
  showsIbomCard: boolean;
  companionPrompt: string;
  companionLinks: readonly CompanionLink[];
}

/** Ordered metadata catalog for all 6 Build Checklist steps (total = 211 items, 81 images). */
export const BUILD_CHECKLISTS_CATALOG: readonly BuildChecklistMeta[] = [
  {
    num: '01',
    slug: '01-main-board-ordering',
    sourceFile: 'checklists/01-main-board-ordering.md',
    route: '/build/01-main-board-ordering/',
    shortTitle: 'Main Board Ordering',
    fullTitle: 'Main Board Ordering Checklist (JLCPCB PCB + Bottom-Side PCBA)',
    phaseLabel: 'Step 01 · Fab + Economic Bottom PCBA',
    summary:
      'Configure JLCPCB 2L Black FR4 bare board + Lead-Free Economic Bottom PCBA (`50` SMDs, `3` Extended SKUs, `14` Basic SKUs) with F.SilkS QR placement.',
    totalItems: 42,
    imageCount: 0,
    hasPlacementCards: false,
    showsJlcpcbStrip: true,
    showsIbomCard: false,
    companionPrompt:
      'Visual companion: Inspect main PCB Cu/SilkS renders or launch Interactive BOM to audit the 50-part PCBA split.',
    companionLinks: [
      { label: 'Main PCB Plates →', href: '/hardware/#pcb' },
      { label: 'All Fab Downloads →', href: '/downloads/' },
    ],
  },
  {
    num: '01b',
    slug: '01b-front-panel-ordering',
    sourceFile: 'checklists/01b-front-panel-ordering.md',
    route: '/build/01b-front-panel-ordering/',
    shortTitle: 'Front Panel Ordering',
    fullTitle: 'Front Panel Ordering Checklist (JLCPCB Bare PCB — Matte Black + ENIG)',
    phaseLabel: 'Step 01b · Combined Bare Panel Order',
    summary:
      'Order the mated 6 HP (`30.0 × 128.5 mm`) Eurorack faceplate in Matte Black + ENIG-RoHS + White silkscreen with QR placed exclusively on B.SilkS.',
    totalItems: 22,
    imageCount: 0,
    hasPlacementCards: false,
    showsJlcpcbStrip: true,
    showsIbomCard: false,
    companionPrompt:
      'Visual companion: Preview F.Mask ENIG gold + F.SilkS layers or read the exact 1:1 mm panel contract.',
    companionLinks: [
      { label: 'Panel Layer Inspector →', href: '/hardware/#panel' },
      { label: 'Panel SVG Spec →', href: '/specs/panel-svg-spec/' },
    ],
  },
  {
    num: '02',
    slug: '02-pcba-part-alignment',
    sourceFile: 'checklists/02-pcba-part-alignment.md',
    route: '/build/02-pcba-part-alignment/',
    shortTitle: 'PCBA Part Alignment',
    fullTitle: 'PCBA Part Alignment Checklist (50 Bottom-Side SMDs)',
    phaseLabel: 'Step 02 · 3D Orientation Verification',
    summary:
      'Verify rotation, Pin-1 bevels, diode cathodes, and SOT-23 pinouts for every bottom-side SMD inside JLCPCB’s placement viewer against 51 high-res renders.',
    totalItems: 54,
    imageCount: 51,
    hasPlacementCards: true,
    showsJlcpcbStrip: false,
    showsIbomCard: false,
    companionPrompt:
      'Click any render to zoom fullscreen; checking off a component automatically collapses its placement card.',
    companionLinks: [
      { label: 'PCB F.Cu / B.Cu Plates →', href: '/hardware/#pcb' },
      { label: 'Final Design Spec →', href: '/specs/design-spec/' },
    ],
  },
  {
    num: '03',
    slug: '03-tayda-ordering',
    sourceFile: 'checklists/03-tayda-ordering.md',
    route: '/build/03-tayda-ordering/',
    shortTitle: 'Tayda Ordering',
    fullTitle: 'Tayda Electronics Ordering Checklist (Through-Hole & Panel Hardware)',
    phaseLabel: 'Step 03 · Manual THT & Panel Hardware',
    summary:
      'Source all 18 per-board through-hole parts (`A100K`, `2× A1M`, center-detent `B10K`, `Dailywell 2MS1`, `A-1076` bi-color LED, `WIMA` film caps) and `<= 14 mm` knobs.',
    totalItems: 22,
    imageCount: 0,
    hasPlacementCards: false,
    showsJlcpcbStrip: false,
    showsIbomCard: false,
    companionPrompt:
      'Visual companion: Open the Downloads Hub for the full THT summary or inspect panel spacing.',
    companionLinks: [
      { label: 'Downloads & Files →', href: '/downloads/' },
      { label: 'Panel Inspector →', href: '/hardware/#panel' },
    ],
  },
  {
    num: '04',
    slug: '04-hand-assembly',
    sourceFile: 'checklists/04-hand-assembly.md',
    route: '/build/04-hand-assembly/',
    shortTitle: 'Hand Assembly',
    fullTitle: 'Hand Assembly Checklist (Post-PCBA Through-Hole & Panel Build)',
    phaseLabel: 'Step 04 · B.Cu THT Then Dry-Fit Panel Controls',
    summary:
      'Inspect incoming JLCPCB boards, fit B.Cu headers/caps before F.Cu panel controls, dry-fit all 11 panel controls before soldering, and flush-clean `NET_ENV_CAP`.',
    totalItems: 41,
    imageCount: 21,
    hasPlacementCards: true,
    showsJlcpcbStrip: false,
    showsIbomCard: true,
    companionPrompt:
      'Keep Interactive BOM open in a dedicated tab alongside these 21 B.Cu and F.Cu reference renders.',
    companionLinks: [
      { label: 'Open Interactive BOM →', href: '/bom/ibom.html' },
      { label: 'Hardware PCB Plates →', href: '/hardware/#pcb' },
    ],
  },
  {
    num: '05',
    slug: '05-board-bringup',
    sourceFile: 'checklists/05-board-bringup.md',
    route: '/build/05-board-bringup/',
    shortTitle: 'Board Bringup',
    fullTitle: 'Board Bringup & Verification Checklist',
    phaseLabel: 'Step 05 · Cold DMM Checks -> Live Scope Verification',
    summary:
      'Verify polarity, resistance, current-limited ±12 V smoke test, quiescent bias + LED1 color, stage-by-stage `TP1`–`TP12` audio waveforms, and `SLEW IN` normaling.',
    totalItems: 30,
    imageCount: 9,
    hasPlacementCards: false,
    showsJlcpcbStrip: false,
    showsIbomCard: false,
    companionPrompt:
      'Click any probe guide to open fullscreen magnification; use Diagnostic Reference table for fault isolation.',
    companionLinks: [
      { label: '9-Block Schematic →', href: '/hardware/#schematic' },
      { label: 'Patch Guides Hub →', href: '/patches/' },
    ],
  },
];

/** Exact sum of trackable checklist items across all 6 Build Checklist steps. */
export const TOTAL_CHECKLIST_ITEMS: number = BUILD_CHECKLISTS_CATALOG.reduce(
  (sum, item) => sum + item.totalItems,
  0,
);

/** Ordered left-rail navigation items for all /build/* pages. */
export const BUILD_CHECKLIST_NAV_ITEMS: readonly BuildNavItem[] = [
  { label: 'Overview', href: '/build/', badge: '00' },
  ...BUILD_CHECKLISTS_CATALOG.map((step) => ({
    label: step.shortTitle,
    href: step.route,
    badge: step.num,
    slug: step.slug,
  })),
];

const CHECKLIST_BY_SLUG = new Map<string, BuildChecklistMeta>(
  BUILD_CHECKLISTS_CATALOG.map((item) => [item.slug, item]),
);

/** Look up Build Checklist metadata by route slug. */
export function getBuildChecklistBySlug(slug: string): BuildChecklistMeta | undefined {
  return CHECKLIST_BY_SLUG.get(slug);
}
