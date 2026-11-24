import frontSilkscreenRaw from '../../../panel_art/front_silkscreen.svg?raw';
import frontSoldermaskRaw from '../../../panel_art/front_soldermask.svg?raw';
import {
  parseFaceplateLayersFromStrings,
  type FaceplateLayerMarkup,
} from './panel-svg-shared.ts';

let cachedLayers: FaceplateLayerMarkup | null = null;

/** Build-time inlined panel layers parsed once with zero runtime SVG network fetches. */
export function getInlinedFaceplateLayers(): FaceplateLayerMarkup {
  if (!cachedLayers) {
    cachedLayers = parseFaceplateLayersFromStrings(frontSoldermaskRaw, frontSilkscreenRaw);
  }
  return cachedLayers;
}
