import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REQUIRED_PASSTHROUGH_FILES } from '../src/lib/static-passthrough.ts';
import { verifyBuiltSite } from '../src/lib/site-contract.ts';

const tempDirs: string[] = [];

function createValidBuiltFixture(): { repoRoot: string; distDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-contract-'));
  tempDirs.push(root);

  const repoRoot = path.join(root, 'repo');
  const distDir = path.join(root, 'dist');

  const writeBoth = (relPath: string, content: string | Buffer = `data:${relPath}`) => {
    for (const baseDir of [repoRoot, distDir]) {
      const abs = path.join(baseDir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  };

  for (const file of REQUIRED_PASSTHROUGH_FILES) {
    if (file === 'bom/ibom.html') {
      writeBoth(file, Buffer.from('<!doctype html><html><body>Exact iBOM bytes</body></html>'));
    } else {
      writeBoth(file);
    }
  }
  writeBoth('images/panel_front.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeBoth('images/pcb_front.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <title>ENV / SKEW</title>
  </head>
  <body>
    <header>
      <a href="/EnvelopeFollowerWithSkewLimiter/">ENV / SKEW</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/patches/">Patches</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/build/">Build</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/bom/ibom.html">iBOM</a>
      <a href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter">GitHub</a>
    </header>
    <main id="main-content" data-pagefind-body>
      <h1 id="hero-title">TWO MODULES IN 6 HP</h1>
      <a href="#hero-title">Jump</a>
      <img
        src="/EnvelopeFollowerWithSkewLimiter/images/panel_front.png"
        alt="Front panel"
        width="872"
        height="2384"
      />
    </main>
  </body>
</html>`,
  );

  return { repoRoot, distDir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Seam 1 built-site artifact contract', () => {
  it('passes on a valid built fixture with dark color-scheme, data-pagefind-body, explicit image dimensions, and byte-identical passthroughs', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });

    expect(result.errors).toEqual([]);
    expect(result.checkedHtmlRoutes).toEqual(['/']);
    expect(result.verifiedPassthroughs).toBe(REQUIRED_PASSTHROUGH_FILES.length + 2);
    expect(result.verifiedImages).toBe(1);
    expect(result.verifiedLinks).toBeGreaterThanOrEqual(5);
  });

  it('fails if main[data-pagefind-body] or meta[name="color-scheme"][content="dark"] is missing', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    fs.writeFileSync(
      htmlPath,
      fs
        .readFileSync(htmlPath, 'utf8')
        .replace('data-pagefind-body', '')
        .replace('content="dark"', 'content="light dark"'),
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('data-pagefind-body'))).toBe(true);
    expect(result.errors.some((e) => e.includes('color-scheme'))).toBe(true);
  });

  it('fails if an img lacks explicit width/height or resolves to a missing dist file', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    fs.writeFileSync(
      htmlPath,
      fs
        .readFileSync(htmlPath, 'utf8')
        .replace('width="872"', '')
        .replace('panel_front.png', 'missing_panel.png'),
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('width/height'))).toBe(true);
    expect(result.errors.some((e) => e.includes('missing_panel.png'))).toBe(true);
  });

  it('fails if bom/ibom.html in dist differs by even one byte from repo source', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    fs.writeFileSync(
      path.join(distDir, 'bom/ibom.html'),
      '<!doctype html><html><body>Modified iBOM bytes</body></html>',
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('bom/ibom.html'))).toBe(true);
  });

  it('fails if excluded files leak into distDir', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    fs.mkdirSync(path.join(distDir, 'manufacturing/gerbers'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'manufacturing/gerbers/leaked.gbr'), 'G04');
    fs.writeFileSync(path.join(distDir, 'panel_art/panel.vectorcraft'), '{}');
    fs.writeFileSync(path.join(distDir, 'AGENTS.md'), '# leaked');

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('manufacturing/gerbers/leaked.gbr'))).toBe(true);
    expect(result.errors.some((e) => e.includes('panel_art/panel.vectorcraft'))).toBe(true);
    expect(result.errors.some((e) => e.includes('AGENTS.md'))).toBe(true);
  });

  it('fails on third-party asset URLs or internal links missing the base prefix or targeting unknown routes', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    const updated = fs
      .readFileSync(htmlPath, 'utf8')
      .replace(
        '</head>',
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" /></head>',
      )
      .replace(
        'href="/EnvelopeFollowerWithSkewLimiter/patches/"',
        'href="/patches/"',
      )
      .replace(
        'href="/EnvelopeFollowerWithSkewLimiter/build/"',
        'href="/EnvelopeFollowerWithSkewLimiter/not-a-route/"',
      );
    fs.writeFileSync(htmlPath, updated);

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('fonts.googleapis.com'))).toBe(true);
    expect(result.errors.some((e) => e.includes('/patches/'))).toBe(true);
    expect(result.errors.some((e) => e.includes('not-a-route'))).toBe(true);
  });
});
