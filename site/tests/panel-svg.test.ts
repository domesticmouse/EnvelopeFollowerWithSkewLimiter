import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PANEL_CONTROL_COORDS,
  PANEL_VIEWBOX,
  describeSweepArc,
  extractFaceplateLayers,
  parseFaceplateLayersFromStrings,
  polarPoint,
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

  it('strips nested _03_Registration_Frame and id="registration_frame" from gold and silkscreen while preserving standalone registrationFrameSvg, normal arrow, and geometry helpers', () => {
    const maskWithNestedFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_01_F_Mask_Gold">
          <polygon points="13.45,95.47 15.45,95.47 16.55,95.75" fill="#C89B3C" />
          <g id="_03_Registration_Frame"><path d="M0 0 L30 0" fill="#C89B3C" /></g>
          <path d="M0 128.5 L30 128.5" fill="#C89B3C" id="registration_frame" />
        </g>
      </svg>
    `;
    const silkWithNestedFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_02_F_SilkS_White">
          <rect x="1.6" y="12.03" width="26.8" height="0.24" fill="#000000" />
          <g id='_03_Registration_Frame'><path d="M0 0 L30 0" fill="#000000" /></g>
          <path d="M0 128.5 L30 128.5" fill="#000000" id='registration_frame' />
        </g>
      </svg>
    `;

    const nestedLayers = parseFaceplateLayersFromStrings(maskWithNestedFrame, silkWithNestedFrame);
    expect(nestedLayers.goldLayerSvg).toContain('data-normal-arrow="true"');
    expect(nestedLayers.goldLayerSvg).toContain('fill="#D8B154"');
    expect(nestedLayers.goldLayerSvg).not.toContain('_03_Registration_Frame');
    expect(nestedLayers.goldLayerSvg).not.toContain('registration_frame');

    expect(nestedLayers.silkLayerSvg).toContain('fill="#F4F5F7"');
    expect(nestedLayers.silkLayerSvg).not.toContain('_03_Registration_Frame');
    expect(nestedLayers.silkLayerSvg).not.toContain('registration_frame');

    const maskWithStandaloneFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_01_F_Mask_Gold">
          <polygon points="13.45,95.47 15.45,95.47 16.55,95.75" fill="#C89B3C" />
          <path d="M0 0 L1 1" fill="#C89B3C" id="registration_frame" />
        </g>
        <g id="_03_Registration_Frame">
          <path d="M0 128.5 L0 0 L30 0 L30 128.5 Z" fill="#C89B3C" id="registration_frame" />
        </g>
      </svg>
    `;

    const standaloneLayers = parseFaceplateLayersFromStrings(
      maskWithStandaloneFrame,
      silkWithNestedFrame,
    );
    expect(standaloneLayers.goldLayerSvg).not.toContain('registration_frame');
    expect(standaloneLayers.registrationFrameSvg).toContain('id="_03_Registration_Frame"');
    expect(standaloneLayers.registrationFrameSvg).toContain('id="registration_frame"');
    expect(standaloneLayers.registrationFrameSvg).toContain('fill="#4ADE80"');

    const noon = polarPoint(15, 21.25, 5.65, 0);
    expect(noon.x).toBeCloseTo(15, 4);
    expect(noon.y).toBeCloseTo(15.6, 4);
    expect(describeSweepArc(15, 21.25, 5.65, 0, 10)).toContain('A 5.65 5.65 0 1 1');
    expect(describeSweepArc(15, 21.25, 5.65, 5, 5)).toBe('');
  });

  it('strips nested <g> elements inside _03_Registration_Frame and non-self-closing id="registration_frame" elements without leaving dangling closing tags', () => {
    const maskWithNestedAndPairedFrames = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_01_F_Mask_Gold">
          <polygon points="13.45,95.47 15.45,95.47 16.55,95.75" fill="#C89B3C" />
          <g id="_03_Registration_Frame">
            <g class="frame-outer">
              <g class="frame-inner"><path d="M0 0 L30 0" fill="#C89B3C" /></g>
            </g>
          </g>
          <rect id="registration_frame" x="0" y="0" width="30" height="128.5" fill="#C89B3C"></rect>
          <circle cx="15" cy="21.25" r="3.5" fill="#C89B3C" />
        </g>
      </svg>
    `;
    const silkWithPairedGroupFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_02_F_SilkS_White">
          <rect x="1.6" y="12.03" width="26.8" height="0.24" fill="#000000" />
          <g id="registration_frame">
            <g class="silk-frame-child"><path d="M0 0 L30 128.5" fill="#000000" /></g>
          </g>
          <text x="15" y="10" fill="#000000">ENV</text>
        </g>
      </svg>
    `;

    const layers = parseFaceplateLayersFromStrings(
      maskWithNestedAndPairedFrames,
      silkWithPairedGroupFrame,
    );

    expect(layers.goldLayerSvg).toContain('data-normal-arrow="true"');
    expect(layers.goldLayerSvg).toContain('<circle cx="15" cy="21.25" r="3.5" fill="#D8B154" />');
    expect(layers.goldLayerSvg).not.toContain('_03_Registration_Frame');
    expect(layers.goldLayerSvg).not.toContain('frame-outer');
    expect(layers.goldLayerSvg).not.toContain('frame-inner');
    expect(layers.goldLayerSvg).not.toContain('registration_frame');
    expect(layers.goldLayerSvg).not.toContain('</rect>');
    expect(layers.goldLayerSvg.match(/<g\b/g)?.length).toBe(1);
    expect(layers.goldLayerSvg.match(/<\/g>/g)?.length).toBe(1);

    expect(layers.silkLayerSvg).toContain('<text x="15" y="10" fill="#F4F5F7">ENV</text>');
    expect(layers.silkLayerSvg).not.toContain('registration_frame');
    expect(layers.silkLayerSvg).not.toContain('silk-frame-child');
    expect(layers.silkLayerSvg.match(/<g\b/g)?.length).toBe(1);
    expect(layers.silkLayerSvg.match(/<\/g>/g)?.length).toBe(1);

    const maskWithStandaloneNestedFrame = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.00 128.50">
        <g id="_01_F_Mask_Gold">
          <polygon points="13.45,95.47 15.45,95.47 16.55,95.75" fill="#C89B3C" />
        </g>
        <g id="_03_Registration_Frame">
          <g class="standalone-frame"><path d="M0 128.5 L30 128.5" fill="#C89B3C" /></g>
        </g>
      </svg>
    `;
    const standaloneLayers = parseFaceplateLayersFromStrings(
      maskWithStandaloneNestedFrame,
      silkWithPairedGroupFrame,
    );
    expect(standaloneLayers.goldLayerSvg).toContain('data-normal-arrow="true"');
    expect(standaloneLayers.registrationFrameSvg).toContain('id="_03_Registration_Frame"');
    expect(standaloneLayers.registrationFrameSvg).toContain('class="standalone-frame"');
    expect(standaloneLayers.registrationFrameSvg).toContain('fill="#4ADE80"');
  });
});
