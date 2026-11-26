import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = path.resolve(import.meta.dirname, '../src/styles');

describe('self-hosted typography (fonts.css)', () => {
  it('matches the Build Tutorial 14-subset Latin manifest byte-for-byte with zero external URLs', () => {
    const fontsCss = fs.readFileSync(path.join(stylesDir, 'fonts.css'), 'utf8');
    const expected = [
      '/* Self-hosted Latin font subsets via @fontsource/* — zero third-party font or CDN requests */',
      "@import '@fontsource/barlow-condensed/latin-700.css';",
      "@import '@fontsource/barlow-condensed/latin-800.css';",
      '',
      "@import '@fontsource/space-grotesk/latin-500.css';",
      "@import '@fontsource/space-grotesk/latin-600.css';",
      "@import '@fontsource/space-grotesk/latin-700.css';",
      '',
      "@import '@fontsource/ibm-plex-sans/latin-400.css';",
      "@import '@fontsource/ibm-plex-sans/latin-400-italic.css';",
      "@import '@fontsource/ibm-plex-sans/latin-500.css';",
      "@import '@fontsource/ibm-plex-sans/latin-600.css';",
      "@import '@fontsource/ibm-plex-sans/latin-700.css';",
      '',
      "@import '@fontsource/ibm-plex-mono/latin-400.css';",
      "@import '@fontsource/ibm-plex-mono/latin-500.css';",
      "@import '@fontsource/ibm-plex-mono/latin-600.css';",
      "@import '@fontsource/ibm-plex-mono/latin-700.css';",
      '',
    ].join('\n');

    expect(fontsCss).toBe(expected);

    const imports = fontsCss.match(/^@import\s+['"]@fontsource\/[^'"]+\/latin-[^'"]+\.css['"];$/gm);
    expect(imports).toHaveLength(14);
    expect(fontsCss).not.toMatch(/https?:\/\//i);
  });
});

describe('core design tokens (tokens.css)', () => {
  it('defines amber LED tokens, scrollbar tokens, Arial Narrow in --font-slab, and preserves companion-site tokens', () => {
    const tokensCss = fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8');

    expect(tokensCss).toContain('--led-amber: #fbbf24;');
    expect(tokensCss).toContain('--led-amber-bg: #291e09;');
    expect(tokensCss).toContain('--scrollbar-thumb: #7b8294;');
    expect(tokensCss).toContain('--scrollbar-track: #141518;');
    expect(tokensCss).toContain(
      "--font-slab: 'Barlow Condensed', 'DIN Condensed', 'Arial Narrow', system-ui, sans-serif;",
    );
    expect(tokensCss).toContain('scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);');
    expect(tokensCss).toMatch(/Never transition.*scrollbar-color/i);
    expect(tokensCss).not.toContain('::-webkit-scrollbar');

    // Companion Site-specific tokens preserved
    expect(tokensCss).toContain('--led-dark: #c5cad4;');
    expect(tokensCss).toContain('--led-dark-bg: #1e2128;');
    expect(tokensCss).toContain('--page-max-inline: 1200px;');
  });
});

describe('amber LED pills and @media print legibility (global.css)', () => {
  it('routes .led-pill[data-led="amber"] through design tokens instead of hardcoded hex', () => {
    const globalCss = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf8');
    const amberRuleMatch = globalCss.match(/\.led-pill\[data-led='amber'\]\s*\{([^}]*)\}/);
    expect(amberRuleMatch).not.toBeNull();

    const amberRule = amberRuleMatch?.[1] ?? '';
    expect(amberRule).toContain('background: var(--led-amber-bg);');
    expect(amberRule).toContain('color: var(--led-amber);');
    expect(amberRule).toContain('border-color: var(--led-amber);');
    expect(amberRule).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('forces light color-scheme and black-on-white amber LED tokens inside @media print', () => {
    const globalCss = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf8');
    const printIdx = globalCss.indexOf('@media print');
    expect(printIdx).toBeGreaterThan(-1);

    const printSection = globalCss.slice(printIdx);
    const rootRuleMatch = printSection.match(
      /:root,\s*html,\s*body,\s*body\[data-canvas='void'\]\s*\{([^}]*)\}/,
    );
    expect(rootRuleMatch).not.toBeNull();

    const printRootRule = rootRuleMatch?.[1] ?? '';
    expect(printRootRule).toContain('color-scheme: light !important;');
    expect(printRootRule).toContain('--led-amber: #000000;');
    expect(printRootRule).toContain('--led-amber-bg: #ffffff;');
  });
});
