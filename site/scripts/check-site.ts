import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCH_STATES } from '../src/data/patch-states.ts';
import { verifyBuiltSite } from '../src/lib/site-contract.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(siteDir, '..');
const distDir = path.join(siteDir, 'dist');

const result = verifyBuiltSite({
  distDir,
  repoRoot,
  implementedRoutes: [
    '/',
    '/patches/',
    ...PATCH_STATES.map((p) => `/patches/${p.slug}/`),
    '/specs/',
    '/specs/design-spec/',
    '/specs/base-circuit/',
    '/specs/circuit-review/',
    '/specs/panel-svg-spec/',
  ],
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
