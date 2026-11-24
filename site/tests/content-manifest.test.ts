import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWLISTED_MARKDOWN_FILES,
  BUILD_CHECKLIST_FILES,
  MD_TO_ROUTE,
  PATCH_GUIDE_FILES,
  REFERENCE_SPECS_CATALOG,
  REFERENCE_SPEC_FILES,
  extractDocumentTitle,
  hasMermaidFence,
  resolveRepoHref,
} from '../src/lib/content-manifest.ts';
import { readImageDimensions } from '../src/lib/image-dimensions.ts';
import { GITHUB_REPO_URL, SITE_BASE } from '../src/lib/routes.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const tempDirs: string[] = [];

function makeSyntheticPng(width: number, height: number): Buffer {
  // Minimal PNG signature + IHDR chunk (25 bytes total for header inspection)
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 6; // RGBA
  return buf;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('content-manifest allowlist and canonical routing', () => {
  it('enforces strictly the 20 allowlisted hardware Markdown files and confirms every file exists in repo root', () => {
    expect(REFERENCE_SPEC_FILES).toHaveLength(4);
    expect(BUILD_CHECKLIST_FILES).toHaveLength(7);
    expect(PATCH_GUIDE_FILES).toHaveLength(9);
    expect(ALLOWLISTED_MARKDOWN_FILES).toHaveLength(20);
    expect(new Set(ALLOWLISTED_MARKDOWN_FILES).size).toBe(20);

    expect(ALLOWLISTED_MARKDOWN_FILES).not.toContain('README.md');
    expect(ALLOWLISTED_MARKDOWN_FILES).not.toContain('AGENTS.md');
    expect(ALLOWLISTED_MARKDOWN_FILES).not.toContain('GLOSSARY.md');

    for (const relPath of ALLOWLISTED_MARKDOWN_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, relPath))).toBe(true);
      expect(MD_TO_ROUTE[relPath]).toBeDefined();
    }
  });

  it('orders the 4 Reference Specs in engineering evolution and mechanical order with companion banners', () => {
    expect(REFERENCE_SPECS_CATALOG.map((item) => item.slug)).toEqual([
      'base-circuit',
      'circuit-review',
      'design-spec',
      'panel-svg-spec',
    ]);
    for (const spec of REFERENCE_SPECS_CATALOG) {
      expect(spec.route).toBe(`/specs/${spec.slug}/`);
      expect(spec.companionLinks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('resolves relative .md routes with #anchors, passthroughs, directory aliases, and GitHub CAD/Python fallbacks', () => {
    // Root spec -> root spec & passthrough
    expect(resolveRepoHref('EnvelopeFollower.md', 'DesignSpec.md')).toBe(
      `${SITE_BASE}/specs/base-circuit/`,
    );
    expect(
      resolveRepoHref(
        'EnvelopeFollower.md#6-practical-build--pcb-implementation-notes',
        'EnvelopeFollowerImprovements.md',
      ),
    ).toBe(`${SITE_BASE}/specs/base-circuit/#6-practical-build--pcb-implementation-notes`);
    expect(resolveRepoHref('EnvelopeFollower.webp', 'EnvelopeFollower.md')).toBe(
      `${SITE_BASE}/EnvelopeFollower.webp`,
    );

    // Checklist relative links
    expect(resolveRepoHref('02-pcba-part-alignment.md', 'checklists/01-main-board-ordering.md')).toBe(
      `${SITE_BASE}/build/02-pcba-part-alignment/`,
    );
    expect(resolveRepoHref('../bom/ibom.html', 'checklists/04-hand-assembly.md')).toBe(
      `${SITE_BASE}/bom/ibom.html`,
    );
    expect(resolveRepoHref('../panel_art/', 'checklists/README.md')).toBe(
      `${SITE_BASE}/hardware/#panel`,
    );

    // Patch guide relative links
    expect(resolveRepoHref('README.md', 'patches/01-sidechain-ducking.md')).toBe(
      `${SITE_BASE}/patches/`,
    );
    expect(resolveRepoHref('../DesignSpec.md', 'patches/README.md')).toBe(
      `${SITE_BASE}/specs/design-spec/`,
    );

    // Non-site CAD/Python fallback links -> GitHub blob/main
    expect(resolveRepoHref('../envelope_follower.kicad_pcb', 'checklists/01-main-board-ordering.md')).toBe(
      `${GITHUB_REPO_URL}/blob/main/envelope_follower.kicad_pcb`,
    );
    expect(resolveRepoHref('../envelope_follower.py', 'patches/README.md')).toBe(
      `${GITHUB_REPO_URL}/blob/main/envelope_follower.py`,
    );
    expect(resolveRepoHref('generate_bringup_images.py', 'checklists/README.md')).toBe(
      `${GITHUB_REPO_URL}/blob/main/checklists/generate_bringup_images.py`,
    );

    // External URLs and bare fragments stay unchanged
    expect(resolveRepoHref('https://example.com/test', 'DesignSpec.md')).toBe(
      'https://example.com/test',
    );
    expect(resolveRepoHref('#section-1', 'DesignSpec.md')).toBe('#section-1');
  });

  it('extracts page title from first H1 heading without YAML frontmatter and detects mermaid fences', () => {
    expect(
      extractDocumentTitle('# **ENV / SKEW** — `6 HP` Spec\n\n## Details\n'),
    ).toBe('ENV / SKEW — 6 HP Spec');

    expect(
      extractDocumentTitle('# Ignored raw\n', [{ depth: 1, text: 'Envelope Follower Circuit Specification' }]),
    ).toBe('Envelope Follower Circuit Specification');

    expect(hasMermaidFence('## Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')).toBe(true);
    expect(hasMermaidFence('## JSON\n\n```json\n{"a": 1}\n```\n')).toBe(false);
  });
});

describe('image-dimensions PNG/WebP header reader', () => {
  it('reads exact dimensions from a synthetic PNG header and real repository images', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-img-'));
    tempDirs.push(tmpDir);
    const pngPath = path.join(tmpDir, 'synthetic.png');
    fs.writeFileSync(pngPath, makeSyntheticPng(1234, 567));

    expect(readImageDimensions(pngPath)).toEqual({ width: 1234, height: 567 });
    expect(readImageDimensions(path.join(tmpDir, 'missing.png'))).toBeNull();

    const realPanelDims = readImageDimensions(path.join(REPO_ROOT, 'panel_art/preview_clean.png'));
    expect(realPanelDims).not.toBeNull();
    expect(realPanelDims!.width).toBeGreaterThan(0);
    expect(realPanelDims!.height).toBeGreaterThan(0);

    const realWebpDims = readImageDimensions(path.join(REPO_ROOT, 'EnvelopeFollower.webp'));
    expect(realWebpDims).toEqual({ width: 1551, height: 1019 });
  });
});
