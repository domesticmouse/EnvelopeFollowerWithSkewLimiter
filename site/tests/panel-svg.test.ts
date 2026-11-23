import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PANEL_CONTROL_COORDS,
  PANEL_VIEWBOX,
  extractFaceplateLayers,
  tickToDeg,
} from '../src/lib/panel-svg.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('panel-svg faceplate layer extractor and geometry', () => {
  it('defines the locked 6 HP x 3U viewBox and all 11 hardware coordinates in mm', () => {
    expect(PANEL_VIEWBOX).toBe('0 0 30.00 128.50');
    expect(Object.keys(PANEL_CONTROL_COORDS)).toHaveLength(11);
    expect(PANEL_CONTROL_COORDS.rv1).toEqual({ x: 15.0, y: 21.25, kind: 'pot', label: 'GAIN' });
    expect(PANEL_CONTROL_COORDS.rv2).toEqual({ x: 15.0, y: 36.75, kind: 'pot', label: 'ATK' });
    expect(PANEL_CONTROL_COORDS.rv3).toEqual({ x: 15.0, y: 52.25, kind: 'pot', label: 'REL' });
    expect(PANEL_CONTROL_COORDS.rv4).toEqual({ x: 15.0, y: 67.75, kind: 'pot', label: 'OFFSET' });
    expect(PANEL_CONTROL_COORDS.sw1).toEqual({
      x: 7.0,
      y: 82.25,
      kind: 'switch',
      label: 'SMOOTH / RAW',
    });
    expect(PANEL_CONTROL_COORDS.led1).toEqual({ x: 15.0, y: 82.25, kind: 'led', label: '+ / − LED' });
    expect(PANEL_CONTROL_COORDS.sw2).toEqual({
      x: 23.0,
      y: 82.25,
      kind: 'switch',
      label: 'SLOW / FAST',
    });
    expect(PANEL_CONTROL_COORDS.j1).toEqual({ x: 8.0, y: 95.75, kind: 'jack', label: 'IN' });
    expect(PANEL_CONTROL_COORDS.j2).toEqual({ x: 22.0, y: 95.75, kind: 'jack', label: 'SLEW IN' });
    expect(PANEL_CONTROL_COORDS.j3).toEqual({ x: 8.0, y: 110.75, kind: 'jack', label: 'OUT' });
    expect(PANEL_CONTROL_COORDS.j4).toEqual({ x: 22.0, y: 110.75, kind: 'jack', label: 'INV OUT' });
  });

  it('maps 11-tick dial steps cleanly from 7 o’clock (-150°) to 5 o’clock (+150°)', () => {
    expect(tickToDeg(0)).toBe(-150);
    expect(tickToDeg(5)).toBe(0);
    expect(tickToDeg(10)).toBe(150);
  });

  it('extracts and recolors real panel_art SVG layers while dropping the registration frame', () => {
    const { goldLayerSvg, silkLayerSvg } = extractFaceplateLayers(REPO_ROOT);

    expect(goldLayerSvg).toContain('id="_01_F_Mask_Gold"');
    expect(goldLayerSvg).toContain('fill="#D8B154"');
    expect(goldLayerSvg).not.toContain('#C89B3C');
    expect(goldLayerSvg).toContain('data-normal-arrow="true"');
    expect(goldLayerSvg).not.toContain('_03_Registration_Frame');

    expect(silkLayerSvg).toContain('id="_02_F_SilkS_White"');
    expect(silkLayerSvg).toContain('fill="#F4F5F7"');
    expect(silkLayerSvg).not.toContain('#000000');
    expect(silkLayerSvg).not.toContain('_03_Registration_Frame');
  });

  it('throws a clear error if a required SVG file or layer group is missing', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-panel-svg-'));
    tempDirs.push(tmpRoot);
    expect(() => extractFaceplateLayers(tmpRoot)).toThrow(/front_soldermask\.svg/);

    fs.mkdirSync(path.join(tmpRoot, 'panel_art'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'panel_art/front_soldermask.svg'), '<svg></svg>');
    fs.writeFileSync(path.join(tmpRoot, 'panel_art/front_silkscreen.svg'), '<svg></svg>');
    expect(() => extractFaceplateLayers(tmpRoot)).toThrow(/_01_F_Mask_Gold/);
  });
});
