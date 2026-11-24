import { clampPan, clampScale, type PanOffset } from '../lib/zoom-pan-math.ts';

/** Canonical A3 landscape schematic dimensions in mm (from generate_schematic.py). */
export const A3_SHEET_MM = { width: 420.0, height: 297.0 } as const;

/** Lossless rendered schematic dimensions in pixels (images/schematic.png). */
export const SCHEMATIC_IMAGE_PX = { width: 2400, height: 1697 } as const;

export interface SchematicBlock {
  num: number;
  label: string;
  title: string;
  mmBox: readonly [x1: number, y1: number, x2: number, y2: number];
  href: string;
  linkLabel: string;
  note: string;
}

/**
 * 9 A3 schematic zone coordinates extracted directly from generate_schematic.py add_section_box()
 * mapped to deep-link anchors in /specs/design-spec/ and /build/05-board-bringup/.
 */
export const SCHEMATIC_BLOCKS: readonly SchematicBlock[] = [
  {
    num: 1,
    label: '1. Input & ×2 Preamp',
    title: 'Block 1 · Input & ×2 Preamp (U1A)',
    mmBox: [15.24, 15.24, 134.62, 109.22],
    href: '/specs/design-spec/#52-input-stage--2-preamp-j1-r3r7-c7c9-rv1-u1a',
    linkLabel: 'Design Spec §5.2 →',
    note: 'J1 (90.9 kΩ, 3.72 Hz HPF), RV1 A100K attenuator, switchless ×2.00 AC / ×1.00 DC U1A preamp.',
  },
  {
    num: 2,
    label: '2. Full-Wave Rectifier',
    title: 'Block 2 · Precision Full-Wave Rectifier (U1B, U1C, D3)',
    mmBox: [137.16, 15.24, 281.94, 109.22],
    href: '/specs/design-spec/#53-precision-full-wave-rectifier-r8r14-d3-u1b-u1c',
    linkLabel: 'Design Spec §5.3 →',
    note: 'BAT54S dual Schottky D3 inside U1B + 0.1% thin-film summing in U1C (+1.000× calibrated unity).',
  },
  {
    num: 3,
    label: '3. Power & Decoupling',
    title: 'Block 3 · Power Rails & Decoupling (J_PWR, U1E, U2E)',
    mmBox: [284.48, 15.24, 406.4, 109.22],
    href: '/specs/design-spec/#51-power-rails--protection-j_pwr-d1d2-r1r2-c1c6',
    linkLabel: 'Design Spec §5.1 →',
    note: 'Shrouded 10-pin J_PWR, series B5819W Schottkys, 10 Ω + 47 µF RC bulk rails, and 4× 100 nF local bypasses.',
  },
  {
    num: 4,
    label: '4. Skew Limiter Core',
    title: 'Block 4 · SLEW IN & Active Skew Limiter (J2, U1D, U2A, SW2)',
    mmBox: [15.24, 114.3, 198.12, 205.74],
    href: '/specs/design-spec/#55-active-asymmetric-skew-limiter-u1d-u2a-r18r20-c10c13-d4d5-rv2rv3-sw2',
    linkLabel: 'Design Spec §5.5 →',
    note: 'Normaled J2 SLEW IN, 2-op-amp loop (U1D + U2A), C10 2.2 nF compensation, 1N4148W D4/D5, SW2 FAST/SLOW.',
  },
  {
    num: 5,
    label: '5. SMOOTH T-Filter',
    title: 'Block 5 · SMOOTH Split-Resistor T-Filter (SW1)',
    mmBox: [200.66, 114.3, 251.46, 205.74],
    href: '/specs/design-spec/#56-smooth-split-r_env-t-filter-r21r22-c14-sw1',
    linkLabel: 'Design Spec §5.6 →',
    note: '2× 49.9 kΩ R21/R22 + 220 nF C14 (f_c = 29.0 Hz, −11.1 dB @ 100 Hz, 0.00% DC amplitude drop).',
  },
  {
    num: 6,
    label: '6. Output & Inverter',
    title: 'Block 6 · Output Summer (U2B) & Unity Inverter (U2C)',
    mmBox: [254.0, 114.3, 406.4, 205.74],
    href: '/specs/design-spec/#57-virtual-ground-output-summer-filtered-offset--unity-inverter-u2b-u2c-r23r32-c15c16-rv4-j3-j4',
    linkLabel: 'Design Spec §5.7 →',
    note: 'Virtual-ground summer U2B → J4 INV_OUT and 0.1% inverter U2C → J3 OUT via 1 kΩ protection resistors.',
  },
  {
    num: 7,
    label: '7. OFFSET Bias',
    title: 'Block 7 · RC-Filtered OFFSET Bias (RV4)',
    mmBox: [15.24, 210.82, 114.3, 281.94],
    href: '/specs/design-spec/#57-virtual-ground-output-summer-filtered-offset--unity-inverter-u2b-u2c-r23r32-c15c16-rv4-j3-j4',
    linkLabel: 'Design Spec §5.7 →',
    note: '±4.98 V divider across RV4 B10K center-detent pot with 16.7 Hz C15/C16 rail ripple filtering.',
  },
  {
    num: 8,
    label: '8. Active LED Driver',
    title: 'Block 8 · Active Bi-Color LED Driver (U2D, LED1)',
    mmBox: [116.84, 210.82, 195.58, 281.94],
    href: '/specs/design-spec/#58-post-offset-active-bi-color-led-driver-u2d-led1-r33',
    linkLabel: 'Design Spec §5.8 →',
    note: 'Post-offset transconductance driver U2D sensing NET_ENV_SENSE across anti-parallel R/G LED1 and R33 2.2 kΩ.',
  },
  {
    num: 9,
    label: '9. DNP Test Points',
    title: 'Block 9 · DNP Test Points (TP1–TP12, B.Cu)',
    mmBox: [198.12, 210.82, 297.18, 281.94],
    href: '/build/05-board-bringup/#test-point-reference-12-bcu-test-points',
    linkLabel: 'Bringup Checklist §TP1–TP12 →',
    note: '12 1.0 mm B.Cu probe pads covering GND, ±12V, PRE, HWR, RECT, ENV, INV, OUT, DRV, OFF, and GND_REF.',
  },
];

/** Map an A3 mm bounding box onto a pixel viewport transform (scale + tx/ty). */
export function computeFocusTransform(
  block: SchematicBlock,
  viewportW: number,
  viewportH: number,
  imageW: number = SCHEMATIC_IMAGE_PX.width,
  imageH: number = SCHEMATIC_IMAGE_PX.height,
  maxScale = 3,
): { scale: number } & PanOffset {
  const [x1, y1, x2, y2] = block.mmBox;
  const pxX1 = (x1 / A3_SHEET_MM.width) * imageW;
  const pxY1 = (y1 / A3_SHEET_MM.height) * imageH;
  const pxW = ((x2 - x1) / A3_SHEET_MM.width) * imageW;
  const pxH = ((y2 - y1) / A3_SHEET_MM.height) * imageH;

  const pad = 0.92;
  const targetScale = Math.min((viewportW * pad) / pxW, (viewportH * pad) / pxH);
  const minScale = Math.min(viewportW / imageW, viewportH / imageH, 1);
  const scale = clampScale(targetScale, minScale, maxScale);

  const centerX = pxX1 + pxW / 2;
  const centerY = pxY1 + pxH / 2;
  const rawTx = viewportW / 2 - centerX * scale;
  const rawTy = viewportH / 2 - centerY * scale;

  const clamped = clampPan(rawTx, rawTy, scale, viewportW, viewportH, imageW, imageH);
  return { scale, ...clamped };
}
