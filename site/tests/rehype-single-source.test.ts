import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { VFile } from 'vfile';
import { afterEach, describe, expect, it } from 'vitest';
import { remarkPromoteDoubleDollarMath } from '../src/plugins/remark-double-dollar-math.ts';
import { rehypeSingleSource } from '../src/plugins/rehype-single-source.ts';
import { GITHUB_REPO_URL, SITE_BASE } from '../src/lib/routes.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const tempDirs: string[] = [];

function makeSyntheticPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 6;
  return buf;
}

async function renderMarkdown(
  markdown: string,
  sourceRepoPath: string,
  repoRoot: string = REPO_ROOT,
): Promise<{ html: string; doc: Document; cleanup: () => void }> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPromoteDoubleDollarMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeKatex, { strict: false })
    .use(rehypeSingleSource, { repoRoot, sourceRepoPath })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = new VFile({
    value: markdown,
    path: path.join(repoRoot, sourceRepoPath),
  });
  const result = await processor.process(file);
  const html = String(result.value);

  const win = new Window();
  win.document.body.innerHTML = html;
  return {
    html,
    doc: win.document as unknown as Document,
    cleanup: () => win.close(),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('rehype-single-source Markdown transform pipeline', () => {
  it('parses GFM pipe tables nested inside raw HTML <td> without double-wrapping the layout table', async () => {
    const md = `
## Front-Panel Control Reference

<table>
<tr>
<td width="240" valign="top" align="center">
<img src="../panel_art/preview_clean.png" alt="ENV / SKEW 6 HP Front Panel" width="210" fetchpriority="low">
</td>
<td valign="top">

| Control / Jack | Label | Range / Behavior | Notes |
| :--- | :--- | :--- | :--- |
| **Knob 1 (\`RV1\`)** | \`GAIN\` | \`0x\` to \`2.00x\` | Active in IN mode |
| **Knob 2 (\`RV2\`)** | \`ATK\` | \`0.29 ms - 289 ms\` | Attack rate |

</td>
</tr>
</table>
`;
    const { doc, cleanup } = await renderMarkdown(md, 'patches/README.md');
    try {
      const outerTable = doc.querySelector('table.layout-table');
      expect(outerTable).not.toBeNull();
      expect(outerTable?.closest('.table-wrapper')).toBeNull();

      const innerWrapper = doc.querySelector(
        '.table-wrapper[tabindex="0"][role="region"][aria-labelledby="front-panel-control-reference"]',
      );
      expect(innerWrapper).not.toBeNull();

      const innerTable = innerWrapper?.querySelector('table[data-table-kind="narrow"]');
      expect(innerTable).not.toBeNull();
      expect(innerTable?.getAttribute('style')).toContain('--label-2: "Label"');
      expect(innerTable?.getAttribute('style')).toContain('--label-4: "Notes"');

      const rowHeader = innerTable?.querySelector('tbody tr th[scope="row"]');
      expect(rowHeader?.textContent).toContain('Knob 1');

      const img = doc.querySelector('img');
      expect(img?.getAttribute('src')).toBe(`${SITE_BASE}/panel_art/preview_clean.png`);
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('decoding')).toBe('async');
      expect(img?.hasAttribute('fetchpriority')).toBe(false);
      expect(Number(img?.getAttribute('width'))).toBeGreaterThan(210);
      expect(Number(img?.getAttribute('height'))).toBeGreaterThan(200);
    } finally {
      cleanup();
    }
  });

  it('generates GitHub-parity heading IDs for duplicate headings, punctuation, and KaTeX math headings', async () => {
    const md = `
# Envelope Follower Circuit Review

## 6. Practical Build & PCB Implementation Notes

### 4.5 Main Output Gain & Bipolar DC Offset Stage (\`R11\`–\`R16\`, \`RV4\`, \`U1D\`, \`J2\`)

### 1.1 Timing Section

#### Problem

Text

### 1.2 Diode Section

#### Problem

More text

#### Recommended Fix: Active Transconductance ($V$-to-$I$) LED Driver
`;
    const { doc, cleanup } = await renderMarkdown(md, 'EnvelopeFollowerImprovements.md');
    try {
      const h2 = doc.querySelector('h2');
      expect(h2?.id).toBe('6-practical-build--pcb-implementation-notes');

      const h3Offset = doc.querySelector('h3');
      expect(h3Offset?.id).toBe(
        '45-main-output-gain--bipolar-dc-offset-stage-r11r16-rv4-u1d-j2',
      );

      const h4s = [...doc.querySelectorAll('h4')];
      expect(h4s[0]?.id).toBe('problem');
      expect(h4s[1]?.id).toBe('problem-1');
      expect(h4s[2]?.id).toBe('recommended-fix-active-transconductance-v-to-i-led-driver');
    } finally {
      cleanup();
    }
  });

  it('rewrites canonical .md links with anchors and falls back non-site .kicad_pcb / .py links to GitHub blob/main', async () => {
    const md = `
## References

- [Base Spec](EnvelopeFollower.md#6-practical-build--pcb-implementation-notes)
- [WebP Plate](EnvelopeFollower.webp)
- [Panel Art](../panel_art/)
- [Board CAD](../envelope_follower.kicad_pcb)
- [SKiDL Script](../envelope_follower.py)
- [Bringup Script](generate_bringup_images.py)
`;
    const fromRoot = await renderMarkdown(md, 'EnvelopeFollowerImprovements.md');
    try {
      const links = [...fromRoot.doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(links[0]).toBe(
        `${SITE_BASE}/specs/base-circuit/#6-practical-build--pcb-implementation-notes`,
      );
      expect(links[1]).toBe(`${SITE_BASE}/EnvelopeFollower.webp`);
    } finally {
      fromRoot.cleanup();
    }

    const fromChecklists = await renderMarkdown(md, 'checklists/README.md');
    try {
      const links = [...fromChecklists.doc.querySelectorAll('a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(links[2]).toBe(`${SITE_BASE}/hardware/#panel`);
      expect(links[3]).toBe(`${GITHUB_REPO_URL}/blob/main/envelope_follower.kicad_pcb`);
      expect(links[4]).toBe(`${GITHUB_REPO_URL}/blob/main/envelope_follower.py`);
      expect(links[5]).toBe(`${GITHUB_REPO_URL}/blob/main/checklists/generate_bringup_images.py`);
    } finally {
      fromChecklists.cleanup();
    }
  });

  it('wraps panel_svg_spec.md Section 8 JSON fence in <details data-pagefind-ignore> without putting heading inside summary', async () => {
    const md = `
## 2. SVG Canvas

\`\`\`xml
<svg viewBox="0 0 30 128.5"></svg>
\`\`\`

## 8. Machine-Readable Geometry (\`JSON\`)

\`\`\`json
{
  "metadata": { "hp": 6 },
  "components": []
}
\`\`\`
`;
    const specResult = await renderMarkdown(md, 'panel_svg_spec.md');
    try {
      const details = specResult.doc.querySelectorAll('details[data-pagefind-ignore]');
      expect(details).toHaveLength(1);
      const summary = details[0]?.querySelector('summary');
      expect(summary?.textContent).toContain('4 lines');
      expect(summary?.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
      expect(details[0]?.querySelector('pre code')?.textContent).toContain('"hp": 6');

      const heading = specResult.doc.getElementById('8-machine-readable-geometry-json');
      expect(heading?.tagName).toBe('H2');
      expect(heading?.closest('details')).toBeNull();
    } finally {
      specResult.cleanup();
    }

    // Other files with json code fences must NOT be wrapped as §8 appendix
    const otherResult = await renderMarkdown(md, 'DesignSpec.md');
    try {
      expect(otherResult.doc.querySelectorAll('details[data-pagefind-ignore]')).toHaveLength(0);
    } finally {
      otherResult.cleanup();
    }
  });

  it('renders inline/single-line $$ display KaTeX, formula grids, and Mermaid scroll cards', async () => {
    const md = `
## 1. Signal Flow & Math

Zero volt check $0\\,\\text{V}$ and $V_{\\text{pre}} < 0$ inline.

- **Two-state operation:**
  - **When $V_{\\text{pre}} > 0$:** charges smoothly:
    $$V_{\\text{rect}} = +1.1\\,V_{\\text{pre}}$$
  - **When $V_{\\text{pre}} < 0$:** clamps cleanly:
    $$V_{\\text{rect}} = +1.1\\,|V_{\\text{pre}}|$$

\`\`\`mermaid
flowchart LR
  IN --> OUT
\`\`\`
`;
    const { doc, cleanup } = await renderMarkdown(md, 'EnvelopeFollower.md');
    try {
      expect(doc.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(6);
      expect(doc.querySelectorAll('.katex-display')).toHaveLength(2);
      expect(doc.querySelectorAll('ul.formula-grid')).toHaveLength(1);

      const mermaidPre = doc.querySelector(
        'figure.mermaid-card > div.mermaid-scroll[tabindex="0"][role="region"] > pre.mermaid',
      );
      expect(mermaidPre).not.toBeNull();
      expect(mermaidPre?.textContent).toContain('flowchart LR');
    } finally {
      cleanup();
    }
  });

  it('injects intrinsic PNG dimensions from header bytes and preserves wide sticky-matrix attributes', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-rehype-'));
    tempDirs.push(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'images/pcba_alignment'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'checklists'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'images/pcba_alignment/U1.png'),
      makeSyntheticPng(1600, 900),
    );

    const md = `
## Wide Matrix "Test"

| RefDes | Part | Package | Sourcing | Qty | Function |
| :--- | :--- | :--- | :--- | :--- | :--- |
| \`U1\` | \`TL074H\` | SOIC-14 | JLCPCB | 2 | Op-amp |

<img src="../images/pcba_alignment/U1.png" alt="U1 placement" width="540" fetchpriority="low" />
`;
    const { doc, cleanup } = await renderMarkdown(
      md,
      'checklists/02-pcba-part-alignment.md',
      tmpRoot,
    );
    try {
      const img = doc.querySelector('img');
      expect(img?.getAttribute('src')).toBe(`${SITE_BASE}/images/pcba_alignment/U1.png`);
      expect(img?.getAttribute('width')).toBe('1600');
      expect(img?.getAttribute('height')).toBe('900');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('decoding')).toBe('async');
      expect(img?.hasAttribute('fetchpriority')).toBe(false);

      const wideTable = doc.querySelector(
        '.table-wrapper[tabindex="0"][role="region"][aria-labelledby="wide-matrix-test"] > table[data-table-kind="wide"]',
      );
      expect(wideTable).not.toBeNull();
      expect(wideTable?.querySelector('thead th[scope="col"]')).not.toBeNull();
      expect(wideTable?.querySelector('tbody th[scope="row"]')?.textContent).toBe('U1');
    } finally {
      cleanup();
    }
  });

  it('suppresses only ## Patch Guides Index on patches/README.md while keeping reference sections verbatim', async () => {
    const md = fs.readFileSync(path.join(REPO_ROOT, 'patches/README.md'), 'utf8');
    const { doc, cleanup } = await renderMarkdown(md, 'patches/README.md');
    try {
      expect(doc.getElementById('two-modules-in-6-hp')).not.toBeNull();
      expect(doc.getElementById('front-panel-control-reference')).not.toBeNull();
      expect(doc.getElementById('timing-quick-reference')).not.toBeNull();
      expect(doc.getElementById('hardware--technical-references')).not.toBeNull();

      // Nested GFM table inside Front-Panel Control Reference <td> must survive
      expect(doc.querySelector('table.layout-table')).not.toBeNull();
      expect(doc.querySelector('.table-wrapper table[data-table-kind="narrow"]')).not.toBeNull();

      // Static ## Patch Guides Index must be suppressed
      expect(doc.getElementById('patch-guides-index')).toBeNull();
      expect(doc.getElementById('envelope-follower-mode-in-patched-slew-in-unpatched')).toBeNull();
      expect(doc.getElementById('asymmetric-skew-limiter-mode-slew-in-patched')).toBeNull();
      expect(doc.textContent).not.toContain('Companion Modules Needed');
    } finally {
      cleanup();
    }
  });
});
