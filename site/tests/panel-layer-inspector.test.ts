import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeFullscreenLightbox } from '../src/components/zoom-pan-viewer.ts';
import '../src/components/panel-layer-inspector.ts';
import type { PanelLayerInspector } from '../src/components/panel-layer-inspector.ts';
import {
  buildPanelKeepoutOverlayMarkup,
  parsePanelSvgSpecGeometry,
} from '../src/lib/panel-keepouts.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

afterEach(() => {
  closeFullscreenLightbox();
  document.body.innerHTML = '';
});

describe('panel_svg_spec.md §8 JSON keepouts projection', () => {
  it('parses real §8 JSON from panel_svg_spec.md and projects SVG keepouts without coordinate duplication', () => {
    const md = fs.readFileSync(path.join(REPO_ROOT, 'panel_svg_spec.md'), 'utf8');
    const spec = parsePanelSvgSpecGeometry(md);

    expect(spec.canvas.viewBox).toBe('0 0 30.00 128.50');
    expect(spec.mounting_slots).toHaveLength(2);
    expect(spec.components).toHaveLength(11);
    expect(spec.fabrication_rules.min_silk_to_mask_clearance_mm).toBe(0.2);

    const rv1 = spec.components.find((c) => c.ref === 'RV1')!;
    expect(rv1.local_x).toBe(15.0);
    expect(rv1.local_y).toBe(21.25);
    expect(rv1.drill_mm).toBe(7.2);
    expect(rv1.keepout_mm).toBe(11.0);
    expect(rv1.max_knob_mm).toBe(14.0);

    const svgGroup = buildPanelKeepoutOverlayMarkup(spec);
    expect(svgGroup).toContain('id="panel-keepouts-layer"');
    expect(svgGroup).toContain('data-keepout-ref="RV1"');
    expect(svgGroup).toContain('r="7.00"'); // 14.0 / 2 max knob radius
    expect(svgGroup).toContain('r="5.50"'); // 11.0 / 2 keepout radius
    expect(svgGroup).toContain('data-slot-ref="H1"');
    expect(svgGroup).toContain('data-rail-keepout="top"');
  });
});

describe('<panel-layer-inspector> tabs, 4 layer toggles, and lightbox triggers', () => {
  function mountInspector(): PanelLayerInspector {
    const el = document.createElement('panel-layer-inspector') as PanelLayerInspector;
    el.innerHTML = `
      <div slot="layers-overlay-source">${buildPanelKeepoutOverlayMarkup(
        parsePanelSvgSpecGeometry(fs.readFileSync(path.join(REPO_ROOT, 'panel_svg_spec.md'), 'utf8')),
      )}</div>
    `;
    document.body.append(el);
    return el;
  }

  it('defaults to Interactive Layers with F.Mask=on, F.SilkS=on, Keepouts=off, Registration=off and toggles all 4 independently', () => {
    const el = mountInspector();

    const fmaskToggle = el.querySelector<HTMLInputElement>('input[data-layer-toggle="fmask"]')!;
    const fsilksToggle = el.querySelector<HTMLInputElement>('input[data-layer-toggle="fsilks"]')!;
    const keepoutsToggle = el.querySelector<HTMLInputElement>(
      'input[data-layer-toggle="keepouts"]',
    )!;
    const regToggle = el.querySelector<HTMLInputElement>('input[data-layer-toggle="regframe"]')!;

    expect(fmaskToggle.hasAttribute('switch')).toBe(false);
    expect(fmaskToggle.checked).toBe(true);
    expect(fsilksToggle.checked).toBe(true);
    expect(keepoutsToggle.checked).toBe(false);
    expect(regToggle.checked).toBe(false);

    const fmaskGroup = el.querySelector<SVGGElement>('[data-layer="fmask"]')!;
    const fsilksGroup = el.querySelector<SVGGElement>('[data-layer="fsilks"]')!;
    const keepoutsGroup = el.querySelector<SVGGElement>('[data-layer="keepouts"]')!;
    const regGroup = el.querySelector<SVGGElement>('[data-layer="regframe"]')!;
    const legend = el.querySelector<HTMLElement>('[data-keepout-legend]')!;

    expect(fmaskGroup.hasAttribute('hidden')).toBe(false);
    expect(fsilksGroup.hasAttribute('hidden')).toBe(false);
    expect(keepoutsGroup.hasAttribute('hidden')).toBe(true);
    expect(regGroup.hasAttribute('hidden')).toBe(true);
    expect(legend.hidden).toBe(true);

    // Toggle Keepouts ON -> reveals layer and 4-swatch legend
    keepoutsToggle.checked = true;
    keepoutsToggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(keepoutsGroup.hasAttribute('hidden')).toBe(false);
    expect(legend.hidden).toBe(false);
    expect(legend.querySelectorAll('[data-swatch]')).toHaveLength(4);

    // Toggle Registration Frame ON & F.Mask OFF independently
    regToggle.checked = true;
    regToggle.dispatchEvent(new Event('change', { bubbles: true }));
    fmaskToggle.checked = false;
    fmaskToggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(regGroup.hasAttribute('hidden')).toBe(false);
    expect(fmaskGroup.hasAttribute('hidden')).toBe(true);
    expect(fsilksGroup.hasAttribute('hidden')).toBe(false);
  });

  it('switches across 3 WAI-ARIA tabs via keyboard and opens fullscreen <zoom-pan-viewer> for 3D Front/Back and keepouts preview', () => {
    const el = mountInspector();
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...el.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');

    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(panels[1]!.hasAttribute('hidden')).toBe(false);
    expect(panels[0]!.getAttribute('hidden')).toBe('until-found');

    // Click 3D Front lightbox button -> opens fullscreen modal
    const frontLightboxBtn = panels[1]!.querySelector<HTMLButtonElement>('[data-panel-lightbox]')!;
    frontLightboxBtn.click();
    const dialog = document.getElementById('env-skew-lightbox-dialog') as HTMLDialogElement;
    expect(dialog?.open).toBe(true);
    expect(dialog.querySelector('zoom-pan-viewer')?.getAttribute('src')).toContain('panel_front.png');
  });
});
