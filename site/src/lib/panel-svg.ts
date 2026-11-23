import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonical 6 HP × 3U Eurorack panel SVG coordinate space (mm). */
export const PANEL_VIEWBOX = '0 0 30.00 128.50';

/** Hardware control category on the ENV / SKEW front panel. */
export type PanelControlKind = 'pot' | 'switch' | 'led' | 'jack';

/** Physical control center metadata in millimeters. */
export interface PanelControlMeta {
  x: number;
  y: number;
  kind: PanelControlKind;
  label: string;
}

/** Exact hardware centers (mm) for all 11 front-panel controls. */
export const PANEL_CONTROL_COORDS: Readonly<
  Record<
    'rv1' | 'rv2' | 'rv3' | 'rv4' | 'sw1' | 'led1' | 'sw2' | 'j1' | 'j2' | 'j3' | 'j4',
    PanelControlMeta
  >
> = {
  rv1: { x: 15.0, y: 21.25, kind: 'pot', label: 'GAIN' },
  rv2: { x: 15.0, y: 36.75, kind: 'pot', label: 'ATK' },
  rv3: { x: 15.0, y: 52.25, kind: 'pot', label: 'REL' },
  rv4: { x: 15.0, y: 67.75, kind: 'pot', label: 'OFFSET' },
  sw1: { x: 7.0, y: 82.25, kind: 'switch', label: 'SMOOTH / RAW' },
  led1: { x: 15.0, y: 82.25, kind: 'led', label: '+ / − LED' },
  sw2: { x: 23.0, y: 82.25, kind: 'switch', label: 'SLOW / FAST' },
  j1: { x: 8.0, y: 95.75, kind: 'jack', label: 'IN' },
  j2: { x: 22.0, y: 95.75, kind: 'jack', label: 'SLEW IN' },
  j3: { x: 8.0, y: 110.75, kind: 'jack', label: 'OUT' },
  j4: { x: 22.0, y: 110.75, kind: 'jack', label: 'INV OUT' },
};

/** Extracted and recolored F.Mask (gold) and F.SilkS (white) SVG layer markup. */
export interface FaceplateLayerMarkup {
  goldLayerSvg: string;
  silkLayerSvg: string;
}

/** Convert an 11-tick dial step (0..10) to pointer rotation angle in degrees from 12 o'clock. */
export function tickToDeg(tick: number): number {
  return -150 + tick * 30;
}

function extractGroupById(svgText: string, groupId: string, sourceFile: string): string {
  const openRe = new RegExp(`<g\\b[^>]*\\bid=["']${groupId}["'][^>]*>`);
  const openMatch = openRe.exec(svgText);
  if (!openMatch) {
    throw new Error(`Missing <g id="${groupId}"> layer in ${sourceFile}`);
  }

  const startIndex = openMatch.index;
  const tagRe = /<(\/?)g\b([^>]*)>/g;
  tagRe.lastIndex = startIndex;

  let depth = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(svgText)) !== null) {
    const isClosing = tagMatch[1] === '/';
    const attrs = tagMatch[2] ?? '';
    const isSelfClosing = !isClosing && attrs.trimEnd().endsWith('/');

    if (isClosing) {
      depth -= 1;
      if (depth === 0) {
        return svgText.slice(startIndex, tagRe.lastIndex);
      }
    } else if (!isSelfClosing) {
      depth += 1;
    }
  }

  throw new Error(`Unclosed <g id="${groupId}"> layer in ${sourceFile}`);
}

function recolorGroupSvg(groupSvg: string, hexColor: string): string {
  return groupSvg
    .replace(/\bfill="(?!none")[^"]*"/g, `fill="${hexColor}"`)
    .replace(/\bstroke="(?!none")[^"]*"/g, `stroke="${hexColor}"`);
}

function tagNormalArrow(goldGroupSvg: string): string {
  return goldGroupSvg.replace(
    /(<polygon\b[^>]*\bpoints="13\.45,95\.47[^"]*"[^>]*?)\s*\/>/,
    '$1 data-normal-arrow="true" />',
  );
}

function resolveDefaultRepoRoot(): string {
  const candidates = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of candidates) {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, 'panel_art/front_soldermask.svg'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** Read real panel_art/front_soldermask.svg and front_silkscreen.svg layers at build time. */
export function extractFaceplateLayers(repoRoot?: string): FaceplateLayerMarkup {
  const resolvedRoot = path.resolve(repoRoot ?? resolveDefaultRepoRoot());

  const maskFile = path.join(resolvedRoot, 'panel_art/front_soldermask.svg');
  const silkFile = path.join(resolvedRoot, 'panel_art/front_silkscreen.svg');

  if (!fs.existsSync(maskFile) || !fs.statSync(maskFile).isFile()) {
    throw new Error(`Missing required panel artwork file: panel_art/front_soldermask.svg`);
  }
  if (!fs.existsSync(silkFile) || !fs.statSync(silkFile).isFile()) {
    throw new Error(`Missing required panel artwork file: panel_art/front_silkscreen.svg`);
  }

  const maskText = fs.readFileSync(maskFile, 'utf8');
  const silkText = fs.readFileSync(silkFile, 'utf8');

  const rawGoldGroup = extractGroupById(
    maskText,
    '_01_F_Mask_Gold',
    'panel_art/front_soldermask.svg',
  );
  const rawSilkGroup = extractGroupById(
    silkText,
    '_02_F_SilkS_White',
    'panel_art/front_silkscreen.svg',
  );

  return {
    goldLayerSvg: tagNormalArrow(recolorGroupSvg(rawGoldGroup, '#D8B154')),
    silkLayerSvg: recolorGroupSvg(rawSilkGroup, '#F4F5F7'),
  };
}
