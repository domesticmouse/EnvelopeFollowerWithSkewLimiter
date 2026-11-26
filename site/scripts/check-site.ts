import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ROUTES } from '../src/lib/routes.ts';
import { verifyBuiltSite } from '../src/lib/site-contract.ts';

/** Resolved repository root and build output directory for check-site CLI. */
export interface CheckSitePaths {
  repoRoot: string;
  distDir: string;
}

/** Parse `--root <path>` and `--dist <path>` CLI arguments, throwing on invalid or incomplete flags. */
export function parseCheckSiteArgs(
  argv: readonly string[],
  defaults: CheckSitePaths,
): CheckSitePaths {
  let repoRoot = defaults.repoRoot;
  let distDir = defaults.distDir;

  const applyFlag = (flag: '--root' | '--dist', value: string | undefined): void => {
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === '--root') {
      repoRoot = path.resolve(value);
    } else {
      distDir = path.resolve(value);
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--root' || arg === '--dist') {
      applyFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--root=') || arg.startsWith('--dist=')) {
      const eqIdx = arg.indexOf('=');
      applyFlag(arg.slice(0, eqIdx) as '--root' | '--dist', arg.slice(eqIdx + 1));
      continue;
    }

    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return { repoRoot, distDir };
}

/** Run built-site verification from CLI arguments and return an exit code (0, 1, or 2). */
export function runCheckSiteCli(argv: readonly string[]): number {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const siteDir = path.resolve(scriptDir, '..');
  const defaults: CheckSitePaths = {
    repoRoot: path.resolve(siteDir, '..'),
    distDir: path.join(siteDir, 'dist'),
  };

  let paths: CheckSitePaths;
  try {
    paths = parseCheckSiteArgs(argv, defaults);
  } catch (err) {
    console.error(`Usage error: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Usage: node scripts/check-site.ts [--root <path>] [--dist <path>]');
    return 2;
  }

  const result = verifyBuiltSite({
    distDir: paths.distDir,
    repoRoot: paths.repoRoot,
    implementedRoutes: CANONICAL_ROUTES,
    requirePagefind: true,
    verifyReadme: true,
  });

  if (result.errors.length > 0) {
    console.error('Built-site contract FAILED:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  console.log(
    `Built-site contract PASSED: ${result.checkedHtmlRoutes.length} route(s), ${result.verifiedPassthroughs} passthrough(s), ${result.verifiedImages} image(s), ${result.verifiedLinks} link(s).`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCheckSiteCli(process.argv.slice(2)));
}
