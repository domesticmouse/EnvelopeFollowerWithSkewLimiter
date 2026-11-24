import fs from 'node:fs';
import path from 'node:path';
import {
  parseFaceplateLayersFromStrings,
  type FaceplateLayerMarkup,
} from './panel-svg-shared.ts';
import { resolveRepoRoot } from './repo-files.ts';

export * from './panel-svg-shared.ts';

/** Read real panel_art/front_soldermask.svg and front_silkscreen.svg layers at build time. */
export function extractFaceplateLayers(repoRoot?: string): FaceplateLayerMarkup {
  const resolvedRoot = path.resolve(repoRoot ?? resolveRepoRoot());

  const maskFile = path.join(resolvedRoot, 'panel_art/front_soldermask.svg');
  const silkFile = path.join(resolvedRoot, 'panel_art/front_silkscreen.svg');

  if (!fs.existsSync(maskFile) || !fs.statSync(maskFile).isFile()) {
    throw new Error('Missing required panel artwork file: panel_art/front_soldermask.svg');
  }
  if (!fs.existsSync(silkFile) || !fs.statSync(silkFile).isFile()) {
    throw new Error('Missing required panel artwork file: panel_art/front_silkscreen.svg');
  }

  const maskText = fs.readFileSync(maskFile, 'utf8');
  const silkText = fs.readFileSync(silkFile, 'utf8');

  return parseFaceplateLayersFromStrings(maskText, silkText);
}
