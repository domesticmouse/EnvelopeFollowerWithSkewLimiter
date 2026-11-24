export interface PanelMountingSlot {
  ref: string;
  local_x: number;
  local_y: number;
  width_mm: number;
  height_mm: number;
}

export interface PanelComponentSpec {
  ref: string;
  kind: string;
  label: string;
  value: string;
  local_x: number;
  local_y: number;
  drill_mm: number;
  pad_mm: number;
  keepout_mm: number;
  grounded: boolean;
  hole_type: string;
  mpn: string;
  manufacturer: string;
  max_knob_mm: number | null;
}

export interface PanelSvgSpecGeometry {
  metadata: {
    module_name: string;
    version: string;
    hp: number;
  };
  canvas: {
    width_mm: number;
    height_mm: number;
    viewBox: string;
    main_pcb_size_mm: [number, number];
    overhang_mm: { x: number; y: number };
    safe_artwork_bounds_mm: {
      x_min: number;
      y_min: number;
      x_max: number;
      y_max: number;
    };
    rail_keepout_y_mm: {
      top: [number, number];
      bottom: [number, number];
    };
  };
  mounting_slots: PanelMountingSlot[];
  components: PanelComponentSpec[];
  fabrication_rules: {
    min_silk_stroke_mm: number;
    min_silk_text_height_mm: number;
    min_mask_opening_mm: number;
    min_silk_to_mask_clearance_mm: number;
    copper_edge_pullback_mm: number;
  };
}

/** Parse Section 8 JSON directly from panel_svg_spec.md without duplicating coordinates. */
export function parsePanelSvgSpecGeometry(specMarkdown: string): PanelSvgSpecGeometry {
  const sec8Idx = specMarkdown.search(/^##\s+8\.\s+Machine-Readable Geometry/m);
  if (sec8Idx === -1) {
    throw new Error('Missing Section 8 Machine-Readable Geometry heading in panel_svg_spec.md');
  }

  const afterSec8 = specMarkdown.slice(sec8Idx);
  const jsonMatch = /```json\s*([\s\S]*?)```/.exec(afterSec8);
  if (!jsonMatch?.[1]) {
    throw new Error('Missing fenced JSON payload in panel_svg_spec.md Section 8');
  }

  return JSON.parse(jsonMatch[1]) as PanelSvgSpecGeometry;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Project panel_svg_spec.md §8 JSON coordinates into an SVG <g> overlay (1:1 mm space). */
export function buildPanelKeepoutOverlayMarkup(spec: PanelSvgSpecGeometry): string {
  const parts: string[] = ['<g id="panel-keepouts-layer">'];

  // Eurorack rail keepout zones
  const [topY0, topY1] = spec.canvas.rail_keepout_y_mm.top;
  const [botY0, botY1] = spec.canvas.rail_keepout_y_mm.bottom;
  parts.push(
    `<rect data-rail-keepout="top" x="0" y="${topY0.toFixed(2)}" width="${spec.canvas.width_mm.toFixed(2)}" height="${(topY1 - topY0).toFixed(2)}" fill="#F87171" fill-opacity="0.14" stroke="#F87171" stroke-width="0.18" stroke-dasharray="0.9 0.6" />`,
    `<rect data-rail-keepout="bottom" x="0" y="${botY0.toFixed(2)}" width="${spec.canvas.width_mm.toFixed(2)}" height="${(botY1 - botY0).toFixed(2)}" fill="#F87171" fill-opacity="0.14" stroke="#F87171" stroke-width="0.18" stroke-dasharray="0.9 0.6" />`,
  );

  // Safe artwork bounds
  const safe = spec.canvas.safe_artwork_bounds_mm;
  parts.push(
    `<rect data-safe-bounds="true" x="${safe.x_min.toFixed(2)}" y="${safe.y_min.toFixed(2)}" width="${(safe.x_max - safe.x_min).toFixed(2)}" height="${(safe.y_max - safe.y_min).toFixed(2)}" fill="none" stroke="#94A3B8" stroke-width="0.15" stroke-dasharray="1.2 0.8" />`,
  );

  // Mounting slots
  for (const slot of spec.mounting_slots) {
    const x = slot.local_x - slot.width_mm / 2;
    const y = slot.local_y - slot.height_mm / 2;
    const rx = slot.height_mm / 2;
    parts.push(
      `<rect data-slot-ref="${escapeXml(slot.ref)}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${slot.width_mm.toFixed(2)}" height="${slot.height_mm.toFixed(2)}" rx="${rx.toFixed(2)}" fill="none" stroke="#F87171" stroke-width="0.24" />`,
    );
  }

  // Component drill, pad, keepout, and max-knob rings
  for (const comp of spec.components) {
    const cx = comp.local_x.toFixed(2);
    const cy = comp.local_y.toFixed(2);
    const ref = escapeXml(comp.ref);
    parts.push(`<g data-keepout-ref="${ref}">`);
    if (comp.max_knob_mm && comp.max_knob_mm > 0) {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${(comp.max_knob_mm / 2).toFixed(2)}" fill="none" stroke="#C084FC" stroke-width="0.22" stroke-dasharray="0.95 0.65" />`,
      );
    }
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${(comp.keepout_mm / 2).toFixed(2)}" fill="#F59E0B" fill-opacity="0.08" stroke="#F59E0B" stroke-width="0.24" />`,
      `<circle cx="${cx}" cy="${cy}" r="${(comp.drill_mm / 2).toFixed(2)}" fill="none" stroke="#38BDF8" stroke-width="0.25" />`,
      `<text x="${cx}" y="${(comp.local_y + 0.55).toFixed(2)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="1.55" font-weight="700" fill="#38BDF8">${ref}</text>`,
      '</g>',
    );
  }

  parts.push('</g>');
  return parts.join('');
}
