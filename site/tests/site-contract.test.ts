import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCheckSiteArgs } from '../scripts/check-site.ts';
import { CANONICAL_ROUTES } from '../src/lib/routes.ts';
import { REQUIRED_PASSTHROUGH_FILES } from '../src/lib/static-passthrough.ts';
import {
  MERMAID_HEX_STYLE_RE,
  hasMixedLrSubgraphCrossEdges,
  verifyBuiltSite,
} from '../src/lib/site-contract.ts';

const tempDirs: string[] = [];

const CHROME_HEADER_HTML = `<header class="site-header" data-pagefind-ignore>
      <a href="/EnvelopeFollowerWithSkewLimiter/">ENV / SKEW</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/patches/">Patches</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/build/">Build</a>
      <a href="/EnvelopeFollowerWithSkewLimiter/bom/ibom.html">iBOM</a>
      <button type="button" data-search-trigger aria-haspopup="dialog" aria-controls="site-search-dialog">Search</button>
      <a href="https://github.com/domesticmouse/EnvelopeFollowerWithSkewLimiter">GitHub</a>
    </header>
    <dialog id="mobile-nav-drawer" data-pagefind-ignore closedby="any"></dialog>`;

const CHROME_FOOTER_HTML = `<footer class="site-footer" data-pagefind-ignore></footer>
    <dialog id="site-search-dialog" data-pagefind-ignore closedby="any"></dialog>`;

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

  fs.mkdirSync(path.join(distDir, '_astro'), { recursive: true });
  for (const fontFile of [
    'barlow-condensed-latin-700-normal.woff2',
    'space-grotesk-latin-500-normal.woff2',
    'ibm-plex-sans-latin-400-normal.woff2',
    'ibm-plex-mono-latin-400-normal.woff2',
  ]) {
    fs.writeFileSync(path.join(distDir, '_astro', fontFile), Buffer.from('wOF2'));
  }

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
    ${CHROME_HEADER_HTML}
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
    ${CHROME_FOOTER_HTML}
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
    ${CHROME_HEADER_HTML}
    <main id="main-content" data-pagefind-body>
      ${bodyInnerHtml}
    </main>
    ${CHROME_FOOTER_HTML}
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
        <h1>Base Circuit</h1>
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
        <h1>Circuit Review</h1>
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
        <h1>Design Spec</h1>
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
        <h1>Panel SVG Spec</h1>
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
      <article class="doc-prose"><h1>Panel SVG Spec</h1><pre><code>{}</code></pre></article>`,
    );
    writeRouteHtml(
      distDir,
      '/specs/design-spec/',
      `<aside class="companion-banner"><a href="/EnvelopeFollowerWithSkewLimiter/hardware/">Hardware</a></aside>
      <article class="doc-prose">
        <h1>Design Spec</h1>
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
        <h1>Circuit Review</h1>
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

  it('validates root README.md relative links and GitHub Pages URLs when verifyReadme is enabled', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    fs.writeFileSync(path.join(repoRoot, 'DesignSpec.md'), '# Spec');
    fs.writeFileSync(
      path.join(repoRoot, 'README.md'),
      `# ENV / SKEW
<img src="images/panel_front.png" alt="Panel" width="200">
[Live Site](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/patches/)
[Design Spec](DesignSpec.md)
`,
    );

    const valid = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/'],
      verifyReadme: true,
    });
    expect(valid.errors).toEqual([]);

    // Inject broken relative link and broken Pages route into README.md
    fs.writeFileSync(
      path.join(repoRoot, 'README.md'),
      `# ENV / SKEW
[Missing](does/not-exist.md)
[Broken Route](https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/no-such-page/)
`,
    );

    const broken = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/'],
      verifyReadme: true,
    });
    expect(broken.errors.some((e) => e.includes('does/not-exist.md'))).toBe(true);
    expect(broken.errors.some((e) => e.includes('no-such-page'))).toBe(true);
  });

  it('requires all 4 self-hosted .woff2 font families in distDir excluding pagefind/', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    fs.rmSync(path.join(distDir, '_astro/space-grotesk-latin-500-normal.woff2'));
    fs.mkdirSync(path.join(distDir, 'pagefind'), { recursive: true });
    // Even if pagefind/ happened to contain a matching .woff2, it must not satisfy the check
    fs.writeFileSync(
      path.join(distDir, 'pagefind/space-grotesk-latin-500-normal.woff2'),
      Buffer.from('wOF2'),
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('space-grotesk'))).toBe(true);
  });

  it('rejects https?:// in built CSS and EXTERNAL_CDN_DOMAINS in .html/.css/.js excluding pagefind/', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    fs.writeFileSync(
      path.join(distDir, '_astro/site.css'),
      '@font-face { src: url("https://example.com/foo.woff2"); }\n/* cdn.jsdelivr.net */',
    );
    fs.writeFileSync(
      path.join(distDir, '_astro/app.js'),
      'export const endpoint = "https://unpkg.com/pkg/index.js";',
    );
    fs.mkdirSync(path.join(distDir, 'pagefind'), { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'pagefind/pagefind.js'),
      '/* fonts.gstatic.com inside pagefind is ignored */',
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('site.css') && e.includes('http'))).toBe(true);
    expect(result.errors.some((e) => e.includes('cdn.jsdelivr.net'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unpkg.com'))).toBe(true);
    expect(result.errors.some((e) => e.includes('fonts.gstatic.com'))).toBe(false);
  });

  it('allows canonical links under SITE_ORIGIN + SITE_BASE/ while rejecting external link/script references, and allows localStorage', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    fs.writeFileSync(
      path.join(distDir, '_astro/checklist.js'),
      'window.localStorage.getItem("env-skew-checklist-v1");',
    );
    fs.writeFileSync(
      htmlPath,
      fs
        .readFileSync(htmlPath, 'utf8')
        .replace(
          '</head>',
          '<link rel="canonical" href="https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/" /></head>',
        )
        .replace(
          '</body>',
          '<script type="module" src="/EnvelopeFollowerWithSkewLimiter/_astro/checklist.js"></script></body>',
        ),
    );

    const allowed = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(allowed.errors).toEqual([]);

    fs.writeFileSync(
      htmlPath,
      fs
        .readFileSync(htmlPath, 'utf8')
        .replace(
          'https://domesticmouse.github.io/EnvelopeFollowerWithSkewLimiter/',
          'https://other.example.com/EnvelopeFollowerWithSkewLimiter/',
        )
        .replace(
          '</body>',
          '<script src="//evil.example.com/tracker.js"></script></body>',
        ),
    );

    const rejected = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(rejected.errors.some((e) => e.includes('other.example.com'))).toBe(true);
    expect(rejected.errors.some((e) => e.includes('evil.example.com'))).toBe(true);
  });

  it('rejects <img> combining fetchpriority="high" with loading="lazy"', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    fs.writeFileSync(
      htmlPath,
      fs
        .readFileSync(htmlPath, 'utf8')
        .replace('alt="Front panel"', 'alt="Front panel" fetchpriority="high" loading="lazy"'),
    );

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('fetchpriority="high"') && e.includes('loading="lazy"'))).toBe(true);
  });

  it('enforces exactly 1 <h1> per route (rejecting 0 or 2+)', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    writeRouteHtml(distDir, '/specs/', '<p>No heading</p>');
    writeRouteHtml(distDir, '/patches/', '<h1>One</h1><h1>Two</h1>');

    const result = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/', '/specs/', '/patches/'],
    });
    expect(result.errors.some((e) => e.includes('/specs/') && e.includes('h1'))).toBe(true);
    expect(result.errors.some((e) => e.includes('/patches/') && e.includes('h1'))).toBe(true);
  });

  it('enforces chrome data-pagefind-ignore, dialog[closedby="any"], and [data-search-trigger] ARIA invariants', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();
    const htmlPath = path.join(distDir, 'index.html');
    const brokenHtml = fs
      .readFileSync(htmlPath, 'utf8')
      .replace('<header class="site-header" data-pagefind-ignore>', '<header class="site-header">')
      .replace('<footer class="site-footer" data-pagefind-ignore>', '<footer class="site-footer">')
      .replace('<dialog id="mobile-nav-drawer" data-pagefind-ignore closedby="any">', '<dialog id="mobile-nav-drawer">')
      .replace('<dialog id="site-search-dialog" data-pagefind-ignore closedby="any">', '<dialog id="site-search-dialog">')
      .replace('aria-haspopup="dialog" aria-controls="site-search-dialog"', '')
      .replace('</main>', '<dialog id="extra-modal"></dialog></main>');
    fs.writeFileSync(htmlPath, brokenHtml);

    const result = verifyBuiltSite({ repoRoot, distDir, implementedRoutes: ['/'] });
    expect(result.errors.some((e) => e.includes('header.site-header') && e.includes('data-pagefind-ignore'))).toBe(true);
    expect(result.errors.some((e) => e.includes('footer.site-footer') && e.includes('data-pagefind-ignore'))).toBe(true);
    expect(result.errors.some((e) => e.includes('dialog#mobile-nav-drawer') && e.includes('data-pagefind-ignore'))).toBe(true);
    expect(result.errors.some((e) => e.includes('dialog#site-search-dialog') && e.includes('data-pagefind-ignore'))).toBe(true);
    expect(result.errors.some((e) => e.includes('dialog#mobile-nav-drawer') && e.includes('closedby="any"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('dialog#site-search-dialog') && e.includes('closedby="any"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('dialog#extra-modal') && e.includes('closedby="any"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('data-search-trigger') && e.includes('aria-haspopup'))).toBe(true);
  });

  it('detects inline hex styles and mixed LR subgraph cross-edges in Mermaid diagrams', () => {
    expect(MERMAID_HEX_STYLE_RE.test('flowchart LR\n  style A fill:#1b1d22,stroke:#d8b154')).toBe(true);
    expect(MERMAID_HEX_STYLE_RE.test('flowchart LR\n  classDef gold fill:#d8b154')).toBe(true);
    expect(MERMAID_HEX_STYLE_RE.test('flowchart LR\n  A["Node #1"] --> B["Node #2"]')).toBe(false);

    expect(
      hasMixedLrSubgraphCrossEdges(`flowchart LR
  subgraph Stage1
    direction TB
    A --> B
  end
  B --> C`),
    ).toBe(true);

    // Self-contained TB subgraph with no cross-boundary edges is safe
    expect(
      hasMixedLrSubgraphCrossEdges(`flowchart LR
  subgraph Stage1
    direction TB
    A --> B
  end
  X --> Y`),
    ).toBe(false);

    // Non-LR root or matching LR subgraph direction is safe
    expect(
      hasMixedLrSubgraphCrossEdges(`flowchart TB
  subgraph Stage1
    direction LR
    A --> B
  end
  B --> C`),
    ).toBe(false);
    expect(
      hasMixedLrSubgraphCrossEdges(`flowchart LR
  subgraph Stage1
    direction LR
    A --> B
  end
  B --> C`),
    ).toBe(false);
  });

  it('enforces static Mermaid guardrails on built HTML <pre class="mermaid"> and existing ALLOWLISTED_MARKDOWN_FILES', () => {
    const { repoRoot, distDir } = createValidBuiltFixture();

    writeRouteHtml(
      distDir,
      '/hardware/',
      `<h1>Hardware</h1>
      <section id="overview"></section>
      <section id="schematic"></section>
      <section id="pcb"></section>
      <section id="panel"></section>
      <pre class="mermaid">flowchart LR
  style A fill:#ff0000
  A --&gt; B</pre>
      <zoom-pan-viewer></zoom-pan-viewer>
      <panel-layer-inspector></panel-layer-inspector>`,
    );

    fs.mkdirSync(path.join(repoRoot, 'patches'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'patches/01-sidechain-ducking.md'),
      `# 01 — Sidechain Ducking

\`\`\`mermaid
flowchart LR
  subgraph Chain
    direction TB
    KICK --> ENV
  end
  ENV --> VCA
\`\`\`
`,
    );

    const result = verifyBuiltSite({
      repoRoot,
      distDir,
      implementedRoutes: ['/', '/hardware/'],
    });
    expect(result.errors.some((e) => e.includes('/hardware/') && e.includes('hex'))).toBe(true);
    expect(
      result.errors.some((e) => e.includes('patches/01-sidechain-ducking.md') && e.includes('subgraph')),
    ).toBe(true);
  });

  it('parses --root and --dist CLI flags and exits with status 2 on unknown or incomplete flags', () => {
    const defaults = { repoRoot: '/default/repo', distDir: '/default/dist' };
    expect(parseCheckSiteArgs([], defaults)).toEqual(defaults);
    expect(parseCheckSiteArgs(['--root', '/tmp/r', '--dist', '/tmp/d'], defaults)).toEqual({
      repoRoot: path.resolve('/tmp/r'),
      distDir: path.resolve('/tmp/d'),
    });
    expect(() => parseCheckSiteArgs(['--bad-flag'], defaults)).toThrow();
    expect(() => parseCheckSiteArgs(['--reference-dir', '/tmp/ref'], defaults)).toThrow();
    expect(() => parseCheckSiteArgs(['--require-reference'], defaults)).toThrow();
    expect(() => parseCheckSiteArgs(['--root'], defaults)).toThrow();
    expect(() => parseCheckSiteArgs(['--dist'], defaults)).toThrow();
    expect(() => parseCheckSiteArgs(['--root', '--dist', '/tmp/d'], defaults)).toThrow();

    const siteDir = path.resolve(import.meta.dirname, '..');
    for (const args of [
      ['--bad-flag'],
      ['--reference-dir', '/tmp'],
      ['--require-reference'],
      ['--root'],
      ['--dist'],
      ['--root', '--dist', '/tmp'],
    ]) {
      const proc = spawnSync(process.execPath, ['scripts/check-site.ts', ...args], {
        cwd: siteDir,
        encoding: 'utf8',
      });
      expect(proc.status).toBe(2);
    }

    // Valid --root / --dist flags forward paths to verifyBuiltSite (exiting 1 on missing dist, not 2)
    const missingDist = path.join(os.tmpdir(), 'env-skew-nonexistent-dist');
    const customRun = spawnSync(
      process.execPath,
      ['scripts/check-site.ts', '--root', path.resolve(siteDir, '..'), '--dist', missingDist],
      { cwd: siteDir, encoding: 'utf8' },
    );
    expect(customRun.status).toBe(1);
    expect(customRun.stderr).toContain(missingDist);
    expect(CANONICAL_ROUTES.length).toBe(25);
  });
});
