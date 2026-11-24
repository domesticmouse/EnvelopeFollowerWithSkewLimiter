import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ROUTES } from '../src/lib/routes.ts';
import { verifyBuiltSite } from '../src/lib/site-contract.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(siteDir, '..');
const distDir = path.join(siteDir, 'dist');

const result = verifyBuiltSite({
  distDir,
  repoRoot,
  implementedRoutes: CANONICAL_ROUTES,
  requirePagefind: true,
  verifyReadme: true,
});

if (result.errors.length > 0) {
  console.error('Built-site contract FAILED:');
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `Built-site contract PASSED: ${result.checkedHtmlRoutes.length} route(s), ${result.verifiedPassthroughs} passthrough(s), ${result.verifiedImages} image(s), ${result.verifiedLinks} link(s).`,
);
