import panelSvgSpecRaw from '../../../panel_svg_spec.md?raw';
import {
  buildPanelKeepoutOverlayMarkup,
  parsePanelSvgSpecGeometry,
  type PanelSvgSpecGeometry,
} from './panel-keepouts.ts';

let cachedSpec: PanelSvgSpecGeometry | null = null;
let cachedMarkup: string | null = null;

/** Parsed §8 geometry from panel_svg_spec.md at build time. */
export function getInlinedPanelSpecGeometry(): PanelSvgSpecGeometry {
  if (!cachedSpec) {
    cachedSpec = parsePanelSvgSpecGeometry(panelSvgSpecRaw);
  }
  return cachedSpec;
}

/** Build-time SVG keepout overlay markup generated strictly from panel_svg_spec.md §8 JSON. */
export function getInlinedPanelKeepoutMarkup(): string {
  if (!cachedMarkup) {
    cachedMarkup = buildPanelKeepoutOverlayMarkup(getInlinedPanelSpecGeometry());
  }
  return cachedMarkup;
}
