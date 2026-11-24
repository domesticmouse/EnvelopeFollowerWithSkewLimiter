import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFaceplateLayersFromStrings,
  type FaceplateLayerMarkup,
} from './panel-svg-shared.ts';

export * from './panel-svg-shared.ts';

function resolveDefaultRepoRoot(): string {
  const candidates = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of candidates) {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, 'panel_art/front_soldermask.svg'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** Read real panel_art/front_soldermask.svg and front_silkscreen.svg layers at build time. */
export function extractFaceplateLayers(repoRoot?: string): FaceplateLayerMarkup {
  const resolvedRoot = path.resolve(repoRoot ?? resolveDefaultRepoRoot());

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
