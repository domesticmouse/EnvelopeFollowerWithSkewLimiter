import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve the repository root from either site/ or root CWD during Astro SSR/SSG. */
export function resolveRepoRoot(): string {
  const candidates = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of candidates) {
    let dir = path.resolve(start);
    while (true) {
      if (
        fs.existsSync(path.join(dir, 'DesignSpec.md')) &&
        fs.existsSync(path.join(dir, 'bom/ibom.html'))
      ) {
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

/** Format raw byte counts cleanly using IEC-friendly compact decimal sizes (e.g. `221 KB`). */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 100) {
    return `${kb.toFixed(1)} KB`;
  }
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Read a passthrough asset's real byte size from `repoRoot` at build time. */
export function getRepoFileSizeLabel(repoRelPath: string, repoRoot: string = resolveRepoRoot()): string {
  try {
    const stat = fs.statSync(path.join(repoRoot, repoRelPath));
    return formatByteSize(stat.size);
  } catch {
    return '—';
  }
}
