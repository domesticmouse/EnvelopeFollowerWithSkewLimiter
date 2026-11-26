/** Canonical 6 HP × 3U Eurorack panel SVG coordinate space (mm). */
export const PANEL_VIEWBOX = '0 0 30.00 128.50';

/** Hardware control category on the ENV / SKEW front panel. */
export type PanelControlKind = 'pot' | 'switch' | 'led' | 'jack';

/** All 11 front-panel control identifiers. */
export type PanelControlId =
  | 'rv1'
  | 'rv2'
  | 'rv3'
  | 'rv4'
  | 'sw1'
  | 'led1'
  | 'sw2'
  | 'j1'
  | 'j2'
  | 'j3'
  | 'j4';

/** Physical control center metadata in millimeters. */
export interface PanelControlMeta {
  x: number;
  y: number;
  kind: PanelControlKind;
  label: string;
}

/** Exact hardware centers (mm) for all 11 front-panel controls. */
export const PANEL_CONTROL_COORDS: Readonly<Record<PanelControlId, PanelControlMeta>> = {
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

/** Extracted and recolored F.Mask (gold), F.SilkS (white), and optional Registration Frame markup. */
export interface FaceplateLayerMarkup {
  goldLayerSvg: string;
  silkLayerSvg: string;
  registrationFrameSvg: string;
}

/** Convert an 11-tick dial step (0..10) to pointer rotation angle in degrees from 12 o'clock. */
export function tickToDeg(tick: number): number {
  return -150 + tick * 30;
}

/** Compute (x, y) point at radius r and degFrom12 clockwise from 12 o'clock. */
export function polarPoint(
  cx: number,
  cy: number,
  r: number,
  degFrom12: number,
): { x: number; y: number } {
  const rad = ((degFrom12 - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/** Describe an SVG circular arc path between two dial tick steps (0..10). */
export function describeSweepArc(
  cx: number,
  cy: number,
  r: number,
  tickStart: number,
  tickEnd: number,
): string {
  const startDeg = tickToDeg(tickStart);
  const endDeg = tickToDeg(tickEnd);
  if (Math.abs(endDeg - startDeg) < 1) {
    return '';
  }
  const p1 = polarPoint(cx, cy, r, startDeg);
  const p2 = polarPoint(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

function findBalancedTagSpan(
  svgText: string,
  tagName: string,
  openMatch: RegExpExecArray,
): { start: number; end: number } | null {
  const start = openMatch.index;
  if (openMatch[0].trimEnd().endsWith('/>')) {
    return { start, end: start + openMatch[0].length };
  }

  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = new RegExp(`<(\\/?)${escapedTag}\\b([^>]*)>`, 'g');
  tagRe.lastIndex = start;

  let depth = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(svgText)) !== null) {
    const isClosing = tagMatch[1] === '/';
    const attrs = tagMatch[2] ?? '';
    const isSelfClosing = !isClosing && attrs.trimEnd().endsWith('/');

    if (isClosing) {
      depth -= 1;
      if (depth === 0) {
        return { start, end: tagRe.lastIndex };
      }
    } else if (!isSelfClosing) {
      depth += 1;
    }
  }

  return null;
}

function extractGroupById(
  svgText: string,
  groupId: string,
  sourceFile: string,
  required = true,
): string {
  const openRe = new RegExp(`<g\\b[^>]*\\bid=["']${groupId}["'][^>]*>`);
  const openMatch = openRe.exec(svgText);
  if (!openMatch) {
    if (!required) {
      return '';
    }
    throw new Error(`Missing <g id="${groupId}"> layer in ${sourceFile}`);
  }

  const span = findBalancedTagSpan(svgText, 'g', openMatch);
  if (!span) {
    throw new Error(`Unclosed <g id="${groupId}"> layer in ${sourceFile}`);
  }
  return svgText.slice(span.start, span.end);
}

function recolorGroupSvg(groupSvg: string, hexColor: string): string {
  return groupSvg
    .replace(/\bfill="(?!none")[^"]*"/g, `fill="${hexColor}"`)
    .replace(/\bstroke="(?!none")[^"]*"/g, `stroke="${hexColor}"`);
}

function stripElementById(
  svgText: string,
  elementId: string,
  tagNamePattern = '[A-Za-z_][\\w:.-]*',
): string {
  const openRe = new RegExp(
    `<(${tagNamePattern})\\b[^>]*\\bid=["']${elementId}["'][^>]*>`,
    'g',
  );
  let result = svgText;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openRe.exec(result)) !== null) {
    const tagName = openMatch[1];
    if (!tagName) {
      break;
    }
    const span = findBalancedTagSpan(result, tagName, openMatch);
    if (!span) {
      continue;
    }
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
    openRe.lastIndex = span.start;
  }

  return result;
}

function stripRegistrationFrame(svgText: string): string {
  return stripElementById(
    stripElementById(svgText, '_03_Registration_Frame', 'g'),
    'registration_frame',
  );
}

function tagNormalArrow(goldGroupSvg: string): string {
  return goldGroupSvg.replace(
    /(<polygon\b[^>]*\bpoints="13\.45,95\.47[^"]*"[^>]*?)\s*\/>/,
    '$1 data-normal-arrow="true" />',
  );
}

/** Pure string-based parser for front_soldermask.svg and front_silkscreen.svg layers. */
export function parseFaceplateLayersFromStrings(
  maskText: string,
  silkText: string,
): FaceplateLayerMarkup {
  const rawGoldGroup = stripRegistrationFrame(
    extractGroupById(maskText, '_01_F_Mask_Gold', 'panel_art/front_soldermask.svg'),
  );
  const rawSilkGroup = stripRegistrationFrame(
    extractGroupById(silkText, '_02_F_SilkS_White', 'panel_art/front_silkscreen.svg'),
  );
  const rawRegGroup = extractGroupById(
    maskText,
    '_03_Registration_Frame',
    'panel_art/front_soldermask.svg',
    false,
  );

  return {
    goldLayerSvg: tagNormalArrow(recolorGroupSvg(rawGoldGroup, '#D8B154')),
    silkLayerSvg: recolorGroupSvg(rawSilkGroup, '#F4F5F7'),
    registrationFrameSvg: rawRegGroup ? recolorGroupSvg(rawRegGroup, '#4ADE80') : '',
  };
}
