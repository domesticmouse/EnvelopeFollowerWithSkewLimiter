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

function writeRouteHtml(distDir: string, route: string, bodyInnerHtml: string): void {
  const cleanRel = route === '/' ? 'index.html' : `${route.replace(/^\/|\/$/g, '')}/index.html`;
  const targetPath = path.join(distDir, cleanRel);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(
    targetPath,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <title>Test Route</title>
  </head>
  <body>
    <main id="main-content" data-pagefind-body>
      ${bodyInnerHtml}
    </main>
  </body>
</html>`,
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Built-site artifact contract', () => {
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

  it('validates Reference Specs contracts (KaTeX display counts, Mermaid isolation, §8 disclosure, table wrappers, and cross-page anchors)', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const specsRoutes = [
      '/',
      '/specs/',
      '/specs/base-circuit/',
      '/specs/circuit-review/',
      '/specs/design-spec/',
      '/specs/panel-svg-spec/',
    ];

    writeRouteHtml(
      distDir,
      '/specs/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/origin/">Origin</a></aside><article class="doc-prose"><h1>Reference Specs</h1></article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/base-circuit/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/origin/">Origin</a></aside>
      <article class="doc-prose">
        <h2 id="6-practical-build--pcb-implementation-notes">Section 6</h2>
        <pre class="mermaid">flowchart LR\n  A --&gt; B</pre>
        <span class="katex-display"><span class="katex">1</span></span>
        <span class="katex-display"><span class="katex">2</span></span>
        <span class="katex-display"><span class="katex">3</span></span>
        <span class="katex-display"><span class="katex">4</span></span>
        <div class="table-wrapper" tabindex="0" role="region" aria-labelledby="6-practical-build--pcb-implementation-notes">
          <table><thead><tr><th>#</th></tr></thead><tbody><tr><th>1</th></tr></tbody></table>
        </div>
      </article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/circuit-review/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/#schematic">Schematic</a></aside>
      <article class="doc-prose">
        <h2 id="summary">Summary</h2>
        <a href="/EnvelopeFollowerWithSkewLimiter/specs/base-circuit/#6-practical-build--pcb-implementation-notes">Ref</a>
        <pre class="mermaid">flowchart LR\n  C --&gt; D</pre>
        <span class="katex-display"><span class="katex">1</span></span>
        <span class="katex-display"><span class="katex">2</span></span>
        <span class="katex-display"><span class="katex">3</span></span>
      </article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/design-spec/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/">Hardware</a></aside>
      <article class="doc-prose">
        <h2 id="netlist">Netlist</h2>
        <pre class="mermaid">flowchart LR\n  E --&gt; F</pre>
        <span class="katex">x</span>
      </article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/panel-svg-spec/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/#panel">Panel</a></aside>
      <article class="doc-prose">
        <h2 id="8-machine-readable-geometry-json">8. Machine-Readable Geometry</h2>
        <details data-pagefind-ignore><summary>Expand JSON</summary><pre><code>{}</code></pre></details>
      </article>`,
    );

    const validResult = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: specsRoutes });
    expect(validResult.errors).toEqual([]);

    // Inject failures: mermaid chunk on /, missing §8 disclosure, unwrapped table, broken cross-page anchor
    fs.mkdirSync(path.join(distDir, '_astro'), { recursive: true });
    fs.writeFileSync(path.join(distDir, '_astro/leaked.js'), 'const m = "mermaid"; export default m;');
    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      fs
        .readFileSync(path.join(distDir, 'index.html'), 'utf8')
        .replace(
          '</body>',
          '<script type="module" src="/EnvelopeFollowerWithSkewLimiter/_astro/leaked.js"></script></body>',
        ),
    );
    writeRouteHtml(
      distDir,
      '/specs/panel-svg-spec/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/#panel">Panel</a></aside>
      <article class="doc-prose"><pre><code>{}</code></pre></article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/design-spec/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/">Hardware</a></aside>
      <article class="doc-prose">
        <pre class="mermaid">flowchart LR</pre>
        <span class="katex">x</span>
        <table><thead><tr><th>Unwrapped</th></tr></thead></table>
      </article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/circuit-review/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/#schematic">Schematic</a></aside>
      <article class="doc-prose">
        <a href="/EnvelopeFollowerWithSkewLimiter/specs/base-circuit/#missing-anchor">Broken</a>
        <pre class="mermaid">flowchart LR</pre>
        <span class="katex-display"><span class="katex">1</span></span>
        <span class="katex-display"><span class="katex">2</span></span>
        <span class="katex-display"><span class="katex">3</span></span>
      </article>`,
    );

    const brokenResult = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: specsRoutes });
    expect(brokenResult.errors.some((e) => e.includes('Mermaid'))).toBe(true);
    expect(brokenResult.errors.some((e) => e.includes('data-pagefind-ignore'))).toBe(true);
    expect(brokenResult.errors.some((e) => e.includes('table-wrapper'))).toBe(true);
    expect(brokenResult.errors.some((e) => e.includes('missing-anchor'))).toBe(true);
  });

  it('requires Pagefind artifacts when requirePagefind is enabled', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const missing = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/'],
      requirePagefind: true,
    });
    expect(missing.errors.some((e) => e.toLowerCase().includes('pagefind'))).toBe(true);

    fs.mkdirSync(path.join(distDir, 'pagefind'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'pagefind/pagefind.js'), 'export async function search() {}');
    fs.writeFileSync(path.join(distDir, 'pagefind/pagefind-entry.json'), '{"version":"1.0"}');

    const present = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/'],
      requirePagefind: true,
    });
    expect(present.errors).toEqual([]);

    // Fails if any <script> without src leaks an unbundled ESM import statement
    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      fs
        .readFileSync(path.join(distDir, 'index.html'), 'utf8')
        .replace('</body>', '<script slot="scripts">import "./broken.ts";</script></body>'),
    );
    const rawImport = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(rawImport.errors.some((e) => e.includes('unbundled ESM import'))).toBe(true);
  });
});
