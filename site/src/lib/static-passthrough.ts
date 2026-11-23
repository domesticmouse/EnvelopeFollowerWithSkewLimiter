import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { SITE_BASE } from './routes.ts';

/** Explicit allowlisted repository files served and exported verbatim at repo-relative URLs. */
export const REQUIRED_PASSTHROUGH_FILES: readonly string[] = [
  'bom/ibom.html',
  'envelope_follower.pdf',
  'jlcpcb_bom.csv',
  'EnvelopeFollower.webp',
  'manufacturing/envelope_follower_gerbers.zip',
  'manufacturing/envelope_follower_panel_gerbers.zip',
  'manufacturing/jlcpcb_cpl.csv',
  'panel_art/front_silkscreen.svg',
  'panel_art/front_soldermask.svg',
  'panel_art/preview_clean.png',
  'panel_art/preview_keepouts.png',
];

const ALLOWED_PASSTHROUGH_SET = new Set<string>(REQUIRED_PASSTHROUGH_FILES);

const EXCLUDED_FILENAMES = new Set<string>([
  'README.md',
  'AGENTS.md',
  'skills-lock.json',
]);

const EXCLUDED_PREFIXES: readonly string[] = [
  'manufacturing/gerbers/',
  'manufacturing/panel_gerbers/',
  'docs/agents/',
  'docs/research/',
  '.agents/',
];

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
};

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Return true if a repository-relative path belongs to an excluded category that must never publish. */
export function isExcludedRepoPath(relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  if (!normalized) {
    return true;
  }

  const baseName = path.posix.basename(normalized);
  if (EXCLUDED_FILENAMES.has(baseName)) {
    return true;
  }

  if (normalized.endsWith('.vectorcraft') || normalized.endsWith('.py')) {
    return true;
  }

  for (const prefix of EXCLUDED_PREFIXES) {
    const dirOnly = prefix.slice(0, -1);
    if (normalized === dirOnly || normalized.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function walkImagesDir(dirAbs: string, repoRoot: string, out: string[]): void {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walkImagesDir(fullPath, repoRoot, out);
    } else if (entry.isFile()) {
      const rel = toPosixPath(path.relative(repoRoot, fullPath));
      if (!isExcludedRepoPath(rel)) {
        out.push(rel);
      }
    }
  }
}

/** Resolve and validate all allowlisted Static Passthrough repository-relative file paths. */
export function resolvePassthroughFiles(repoRoot: string): string[] {
  const resolvedRoot = path.resolve(repoRoot);
  const files: string[] = [];

  for (const relPath of REQUIRED_PASSTHROUGH_FILES) {
    const absPath = path.join(resolvedRoot, relPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new Error(`Missing required Static Passthrough artifact: ${relPath}`);
    }
    files.push(relPath);
  }

  const imagesRoot = path.join(resolvedRoot, 'images');
  if (!fs.existsSync(imagesRoot) || !fs.statSync(imagesRoot).isDirectory()) {
    throw new Error('Missing required Static Passthrough directory: images/');
  }
  walkImagesDir(imagesRoot, resolvedRoot, files);

  return [...new Set(files)].sort();
}

/** Copy every allowlisted Static Passthrough artifact verbatim into distDir. */
export function copyStaticPassthroughs(repoRoot: string, distDir: string): string[] {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedDist = path.resolve(distDir);
  const files = resolvePassthroughFiles(resolvedRoot);

  for (const relPath of files) {
    const src = path.join(resolvedRoot, relPath);
    const dest = path.join(resolvedDist, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  return files;
}

/** Resolve a normalized relative path safely beneath rootDir if it exists as a regular file. */
export function resolveSafeFileUnderRoot(rootDir: string, relPath: string): string | null {
  if (!relPath || relPath.includes('\0')) {
    return null;
  }
  const segments = relPath.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return null;
  }
  const resolvedRoot = path.resolve(rootDir);
  const candidate = path.resolve(resolvedRoot, relPath);
  const relCheck = path.relative(resolvedRoot, candidate);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return null;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

/** Resolve an incoming dev server request path to an allowlisted Static Passthrough file or null. */
export function resolveDevPassthroughRequest(
  urlPath: string,
  base: string,
  repoRoot: string,
): { filePath: string; contentType: string } | null {
  const rawPathname = (urlPath.split('#')[0] ?? '').split('?')[0] ?? '';
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  if (decodedPath.includes('\0')) {
    return null;
  }

  const normalizedBase = base.replace(/\/+$/, '');
  const requiredPrefix = `${normalizedBase}/`;
  if (!decodedPath.startsWith(requiredPrefix)) {
    return null;
  }

  const relCandidate = decodedPath.slice(requiredPrefix.length);
  if (!relCandidate || relCandidate.endsWith('/')) {
    return null;
  }

  const segments = relCandidate.split('/');
  if (segments.some((seg) => seg.startsWith('.'))) {
    return null;
  }

  const normalizedRel = segments.join('/');
  if (isExcludedRepoPath(normalizedRel)) {
    return null;
  }

  const isAllowlisted =
    ALLOWED_PASSTHROUGH_SET.has(normalizedRel) || normalizedRel.startsWith('images/');
  if (!isAllowlisted) {
    return null;
  }

  const resolvedFile = resolveSafeFileUnderRoot(repoRoot, normalizedRel);
  if (!resolvedFile) {
    return null;
  }

  const ext = path.extname(resolvedFile).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

  return { filePath: resolvedFile, contentType };
}

/** Astro integration serving Static Passthroughs in dev and copying them verbatim on build. */
export function staticPassthroughIntegration(): AstroIntegration {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  let configuredBase = SITE_BASE;

  return {
    name: 'env-skew-static-passthrough',
    hooks: {
      'astro:config:done': ({ config }) => {
        configuredBase = config.base;
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }

          const rawUrl = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';
          const match = resolveDevPassthroughRequest(rawUrl, configuredBase, repoRoot);
          if (!match) {
            next();
            return;
          }

          const stat = fs.statSync(match.filePath);
          res.statusCode = 200;
          res.setHeader('Content-Type', match.contentType);
          res.setHeader('Content-Length', String(stat.size));
          res.setHeader('Cache-Control', 'no-cache');

          if (req.method === 'HEAD') {
            res.end();
            return;
          }

          const stream = fs.createReadStream(match.filePath);
          stream.on('error', next);
          stream.pipe(res);
        });
      },
      'astro:build:done': ({ dir, logger }) => {
        const copied = copyStaticPassthroughs(repoRoot, fileURLToPath(dir));
        logger.info(`Copied ${copied.length} Static Passthrough artifacts verbatim.`);
      },
    },
  };
}
