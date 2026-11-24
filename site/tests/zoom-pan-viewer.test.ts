import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/components/zoom-pan-viewer.ts';
import {
  closeFullscreenLightbox,
  openFullscreenLightbox,
  type ZoomPanViewer,
} from '../src/components/zoom-pan-viewer.ts';
import {
  A3_SHEET_MM,
  SCHEMATIC_BLOCKS,
  SCHEMATIC_IMAGE_PX,
  computeFocusTransform,
} from '../src/data/hardware-schematic.ts';
import { clampPan, clampScale, computeFitScale } from '../src/lib/zoom-pan-math.ts';

afterEach(() => {
  closeFullscreenLightbox();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('zoom-pan math & 9-block schematic focus', () => {
  it('clamps scale up to 300% (3.0) and keeps pan within image bounds', () => {
    const fit = computeFitScale(800, 600, 2400, 1697);
    expect(fit).toBeCloseTo(800 / 2400, 4);

    expect(clampScale(0.1, fit, 3)).toBe(fit);
    expect(clampScale(5.5, fit, 3)).toBe(3.0);

    const bounds = clampPan(5000, -5000, 2.0, 800, 600, 2400, 1697);
    expect(bounds.tx).toBeLessThanOrEqual(0);
    expect(bounds.ty).toBeGreaterThanOrEqual(600 - 1697 * 2.0);
  });

  it('defines all 9 schematic blocks mapped proportionally from A3 420x297 mm to 2400x1697 px', () => {
    expect(A3_SHEET_MM).toEqual({ width: 420.0, height: 297.0 });
    expect(SCHEMATIC_IMAGE_PX).toEqual({ width: 2400, height: 1697 });
    expect(SCHEMATIC_BLOCKS).toHaveLength(9);

    // Block 9 (Test Points) links to /build/05-board-bringup/; Blocks 1..8 link to /specs/design-spec/
    for (const block of SCHEMATIC_BLOCKS.slice(0, 8)) {
      expect(block.href).toMatch(/^\/specs\/design-spec\/#/);
    }
    expect(SCHEMATIC_BLOCKS[8]?.href).toBe(
      '/build/05-board-bringup/#test-point-reference-12-bcu-test-points',
    );

    const t1 = computeFocusTransform(SCHEMATIC_BLOCKS[0]!, 900, 600);
    expect(t1.scale).toBeGreaterThan(0.5);
    expect(t1.scale).toBeLessThanOrEqual(3.0);
  });
});

describe('<zoom-pan-viewer> inline and fullscreen modal behavior', () => {
  it('supports Fit/100%/zoom buttons, 300% cap, focusBlock, Night Blueprint, and scroll-safe Ctrl/Cmd+wheel', () => {
    const viewer = document.createElement('zoom-pan-viewer') as ZoomPanViewer;
    viewer.setAttribute('src', '/EnvelopeFollowerWithSkewLimiter/images/schematic.png');
    viewer.setAttribute('alt', 'ENV / SKEW schematic');
    viewer.setAttribute('width', '2400');
    viewer.setAttribute('height', '1697');
    document.body.append(viewer);

    const stage = viewer.shadowRoot!.querySelector<HTMLElement>('.viewer-stage')!;
    Object.defineProperty(stage, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(stage, 'clientHeight', { value: 600, configurable: true });

    viewer.fit();
    const fitScale = viewer.getScale();
    expect(fitScale).toBeCloseTo(600 / 1697, 3);

    viewer.zoom100();
    expect(viewer.getScale()).toBe(1);

    viewer.setScale(9);
    expect(viewer.getScale()).toBe(3);

    viewer.focusBlock(SCHEMATIC_BLOCKS[4]!);
    expect(viewer.getScale()).toBeGreaterThan(fitScale);
    expect(viewer.getScale()).toBeLessThanOrEqual(3);

    // Night Blueprint toggle
    expect(viewer.nightBlueprint).toBe(false);
    viewer.setNightBlueprint(true);
    expect(viewer.nightBlueprint).toBe(true);
    expect(viewer.shadowRoot!.querySelector('.viewer-img')?.getAttribute('data-night-blueprint')).toBe(
      'true',
    );

    // Plain wheel never calls preventDefault (scroll-safe)
    const plainWheel = new WheelEvent('wheel', { deltaY: -120, cancelable: true });
    stage.dispatchEvent(plainWheel);
    expect(plainWheel.defaultPrevented).toBe(false);

    // Ctrl + wheel zooms and calls preventDefault
    const beforeZoom = viewer.getScale();
    viewer.setScale(1.0);
    const ctrlWheel = new WheelEvent('wheel', { deltaY: -120, cancelable: true });
    Object.defineProperty(ctrlWheel, 'ctrlKey', { value: true });
    stage.dispatchEvent(ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(true);
    expect(viewer.getScale()).toBeGreaterThan(1.0);
    expect(beforeZoom).toBeGreaterThan(0);
  });

  it('opens fullscreen <dialog closedby="any"> with Prev/Next gallery stepping and Front/Back flip toggle', () => {
    const { dialog } = openFullscreenLightbox({
      items: [
        {
          src: '/EnvelopeFollowerWithSkewLimiter/images/pcb_front.png',
          alt: 'Front PCB F.Cu',
          width: 744,
          height: 2416,
          caption: 'Front (F.Cu)',
          flipLabel: 'Front (F.Cu)',
        },
        {
          src: '/EnvelopeFollowerWithSkewLimiter/images/pcb_back.png',
          alt: 'Back PCB B.Cu',
          width: 744,
          height: 2416,
          caption: 'Back (B.Cu)',
          flipLabel: 'Back (B.Cu)',
        },
      ],
      startIndex: 0,
      mode: 'flip',
      allowNightBlueprint: true,
    });

    expect(dialog.getAttribute('closedby')).toBe('any');
    expect(dialog.hasAttribute('role')).toBe(false);
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(dialog.open).toBe(true);

    const modalViewer = dialog.querySelector('zoom-pan-viewer') as ZoomPanViewer;
    expect(modalViewer.getAttribute('src')).toContain('pcb_front.png');

    // Flip button switches to Back (B.Cu)
    const backBtn = dialog.querySelector<HTMLButtonElement>('[data-flip-index="1"]')!;
    backBtn.click();
    expect(backBtn.getAttribute('aria-pressed')).toBe('true');
    expect(modalViewer.getAttribute('src')).toContain('pcb_back.png');

    // Keyboard ArrowLeft steps back to Front (F.Cu)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(modalViewer.getAttribute('src')).toContain('pcb_front.png');

    // Next button wraps or steps forward cleanly
    const nextBtn = dialog.querySelector<HTMLButtonElement>('[data-lightbox-next]')!;
    nextBtn.click();
    expect(modalViewer.getAttribute('src')).toContain('pcb_back.png');
  });
});
