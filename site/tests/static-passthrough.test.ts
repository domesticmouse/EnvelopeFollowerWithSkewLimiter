import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REQUIRED_PASSTHROUGH_FILES,
  copyStaticPassthroughs,
  isExcludedRepoPath,
  resolveDevPassthroughRequest,
  resolvePassthroughFiles,
} from '../src/lib/static-passthrough.ts';

const tempDirs: string[] = [];

function createFixtureRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-passthrough-'));
  tempDirs.push(root);

  const writeFile = (relPath: string, content: string | Buffer = `fixture:${relPath}`) => {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  for (const reqFile of REQUIRED_PASSTHROUGH_FILES) {
    if (reqFile === 'bom/ibom.html') {
      writeFile(reqFile, Buffer.from('<!doctype html><html><body>iBOM v2.11.1 — 18 Manual THT</body></html>'));
    } else {
      writeFile(reqFile);
    }
  }

  // Nested images
  writeFile('images/panel_front.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  writeFile('images/board_bringup/00_test_point_map.png');
  writeFile('images/hand_assembly/J1.png');
  writeFile('images/pcba_alignment/U1.png');
  writeFile('images/.DS_Store', 'junk');

  // Excluded files that must never pass through
  writeFile('README.md', '# Root README');
  writeFile('AGENTS.md', '# Agents');
  writeFile('skills-lock.json', '{}');
  writeFile('envelope_follower.py', 'print("skidl")');
  writeFile('panel_art/envelope_follower_panel.vectorcraft', '{}');
  writeFile('manufacturing/gerbers/envelope_follower-F_Cu.gtl', 'G04');
  writeFile('manufacturing/panel_gerbers/envelope_follower_panel-F_Cu.gtl', 'G04');
  writeFile('docs/agents/issue-tracker.md', '# Tracker');
  writeFile('docs/adr/0001-sample.md', '# ADR 0001');
  writeFile('docs/research/static-site-generators.md', '# Research');
  writeFile('.agents/skills/implement/SKILL.md', '# Skill');

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('static passthrough contract', () => {
  it('resolves all 11 allowlisted files plus images/** while excluding disallowed repo files', () => {
    const repoRoot = createFixtureRepo();
    const resolved = resolvePassthroughFiles(repoRoot);

    expect(resolved).toContain('bom/ibom.html');
    expect(resolved).toContain('envelope_follower.pdf');
    expect(resolved).toContain('jlcpcb_bom.csv');
    expect(resolved).toContain('EnvelopeFollower.webp');
    expect(resolved).toContain('manufacturing/envelope_follower_gerbers.zip');
    expect(resolved).toContain('manufacturing/envelope_follower_panel_gerbers.zip');
    expect(resolved).toContain('manufacturing/jlcpcb_cpl.csv');
    expect(resolved).toContain('panel_art/front_silkscreen.svg');
    expect(resolved).toContain('panel_art/front_soldermask.svg');
    expect(resolved).toContain('panel_art/preview_clean.png');
    expect(resolved).toContain('panel_art/preview_keepouts.png');
    expect(resolved).toContain('images/panel_front.png');
    expect(resolved).toContain('images/board_bringup/00_test_point_map.png');
    expect(resolved).toContain('images/hand_assembly/J1.png');
    expect(resolved).toContain('images/pcba_alignment/U1.png');

    expect(resolved).not.toContain('images/.DS_Store');
    expect(resolved).not.toContain('README.md');
    expect(resolved).not.toContain('AGENTS.md');
    expect(resolved).not.toContain('skills-lock.json');
    expect(resolved).not.toContain('envelope_follower.py');
    expect(resolved).not.toContain('panel_art/envelope_follower_panel.vectorcraft');
    expect(resolved).not.toContain('manufacturing/gerbers/envelope_follower-F_Cu.gtl');
    expect(resolved).not.toContain('manufacturing/panel_gerbers/envelope_follower_panel-F_Cu.gtl');
    expect(resolved).not.toContain('docs/agents/issue-tracker.md');
    expect(resolved).not.toContain('docs/adr/0001-sample.md');
    expect(resolved).not.toContain('docs/research/static-site-generators.md');
    expect(resolved).not.toContain('.agents/skills/implement/SKILL.md');
  });

  it('throws if a required allowlisted passthrough artifact is missing', () => {
    const repoRoot = createFixtureRepo();
    fs.rmSync(path.join(repoRoot, 'bom/ibom.html'));

    expect(() => resolvePassthroughFiles(repoRoot)).toThrow(/bom\/ibom\.html/);
  });

  it('copies bom/ibom.html byte-for-byte identical and excludes disallowed files from dist', () => {
    const repoRoot = createFixtureRepo();
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-skew-dist-'));
    tempDirs.push(distDir);

    copyStaticPassthroughs(repoRoot, distDir);

    const srcIbom = fs.readFileSync(path.join(repoRoot, 'bom/ibom.html'));
    const distIbom = fs.readFileSync(path.join(distDir, 'bom/ibom.html'));
    expect(Buffer.compare(srcIbom, distIbom)).toBe(0);

    expect(fs.existsSync(path.join(distDir, 'images/board_bringup/00_test_point_map.png'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(distDir, 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(distDir, 'AGENTS.md'))).toBe(false);
    expect(fs.existsSync(path.join(distDir, 'envelope_follower.py'))).toBe(false);
    expect(
      fs.existsSync(path.join(distDir, 'panel_art/envelope_follower_panel.vectorcraft')),
    ).toBe(false);
    expect(fs.existsSync(path.join(distDir, 'manufacturing/gerbers'))).toBe(false);
    expect(fs.existsSync(path.join(distDir, 'docs/agents'))).toBe(false);
    expect(fs.existsSync(path.join(distDir, 'docs/adr'))).toBe(false);
  });

  it('resolves allowlisted dev requests with proper MIME types and blocks excluded or traversal paths', () => {
    const repoRoot = createFixtureRepo();
    const base = '/EnvelopeFollowerWithSkewLimiter';

    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/bom/ibom.html?v=1',
        base,
        repoRoot,
      ),
    ).toEqual({
      filePath: path.join(repoRoot, 'bom/ibom.html'),
      contentType: 'text/html; charset=utf-8',
    });

    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/manufacturing/envelope_follower_gerbers.zip',
        base,
        repoRoot,
      ),
    ).toEqual({
      filePath: path.join(repoRoot, 'manufacturing/envelope_follower_gerbers.zip'),
      contentType: 'application/zip',
    });

    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/images/hand_assembly/J1.png',
        base,
        repoRoot,
      ),
    ).toEqual({
      filePath: path.join(repoRoot, 'images/hand_assembly/J1.png'),
      contentType: 'image/png',
    });

    expect(
      resolveDevPassthroughRequest('/EnvelopeFollowerWithSkewLimiter/AGENTS.md', base, repoRoot),
    ).toBeNull();
    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/docs/adr/0001-sample.md',
        base,
        repoRoot,
      ),
    ).toBeNull();
    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/panel_art/envelope_follower_panel.vectorcraft',
        base,
        repoRoot,
      ),
    ).toBeNull();
    expect(
      resolveDevPassthroughRequest(
        '/EnvelopeFollowerWithSkewLimiter/images/%2e%2e/AGENTS.md',
        base,
        repoRoot,
      ),
    ).toBeNull();
    expect(resolveDevPassthroughRequest('/wrong-base/bom/ibom.html', base, repoRoot)).toBeNull();
  });

  it('identifies excluded repository paths consistently', () => {
    expect(isExcludedRepoPath('README.md')).toBe(true);
    expect(isExcludedRepoPath('AGENTS.md')).toBe(true);
    expect(isExcludedRepoPath('skills-lock.json')).toBe(true);
    expect(isExcludedRepoPath('panel_art/envelope_follower_panel.vectorcraft')).toBe(true);
    expect(isExcludedRepoPath('checklists/generate_bringup_images.py')).toBe(true);
    expect(isExcludedRepoPath('manufacturing/gerbers/foo.gbr')).toBe(true);
    expect(isExcludedRepoPath('manufacturing/panel_gerbers/foo.gbr')).toBe(true);
    expect(isExcludedRepoPath('docs/agents/issue-tracker.md')).toBe(true);
    expect(isExcludedRepoPath('docs/adr/0001-sample.md')).toBe(true);
    expect(isExcludedRepoPath('docs/research/static-site-generators.md')).toBe(true);
    expect(isExcludedRepoPath('.agents/skills/implement/SKILL.md')).toBe(true);
    expect(isExcludedRepoPath('bom/ibom.html')).toBe(false);
    expect(isExcludedRepoPath('manufacturing/envelope_follower_gerbers.zip')).toBe(false);
  });
});
