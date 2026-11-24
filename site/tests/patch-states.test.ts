import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PATCH_STATES,
  PATCH_STATES_SCHEMA,
  getPatchStateBySlug,
  ledBadgeInfo,
  validatePatchStates,
} from '../src/data/patch-states.ts';
import { PATCH_GUIDE_FILES } from '../src/lib/content-manifest.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('env-skew-patch-states/v1 sidecar', () => {
  it('maintains 1:1 slug parity with root patches/01..08 files and expected A/B multi-preset counts', () => {
    expect(PATCH_STATES_SCHEMA).toBe('env-skew-patch-states/v1');

    const expectedSlugs = PATCH_GUIDE_FILES.filter((f) => f !== 'patches/README.md').map((f) =>
      path.posix.basename(f, '.md'),
    );
    expect(expectedSlugs).toHaveLength(8);
    expect(PATCH_STATES.map((p) => p.slug)).toEqual(expectedSlugs);

    for (const slug of expectedSlugs) {
      expect(fs.existsSync(path.join(REPO_ROOT, 'patches', `${slug}.md`))).toBe(true);
      const entry = getPatchStateBySlug(slug);
      expect(entry).toBeDefined();
    }

    const multiPresetSlugs = [
      '02-auto-wah-envelope-filter',
      '03-compression-expansion-gating',
      '04-ducking-and-blooming-fx',
      '05-cross-modulation-push-pull',
      '07-asymmetric-portamento-slides',
      '08-gate-to-ar-envelope-and-slewed-mod',
    ];
    for (const slug of multiPresetSlugs) {
      expect(getPatchStateBySlug(slug)?.presets.length).toBe(2);
    }

    expect(getPatchStateBySlug('01-sidechain-ducking')?.presets.length).toBe(1);
    expect(getPatchStateBySlug('06-audio-rate-slew-waveshaping')?.presets.length).toBe(1);
  });

  it('passes schema/bounds validation across all presets, ticks, modes, LED states, and jack enums', () => {
    expect(validatePatchStates(PATCH_STATES)).toEqual([]);

    const efCount = PATCH_STATES.filter((p) => p.mode === 'envelope-follower').length;
    const skewCount = PATCH_STATES.filter((p) => p.mode === 'asymmetric-skew-limiter').length;
    expect(efCount).toBe(5);
    expect(skewCount).toBe(3);

    // Patch 06 must mark SW1 RAW as mandatory
    const patch06 = getPatchStateBySlug('06-audio-rate-slew-waveshaping');
    expect(patch06?.presets[0]?.switches.sw1.state).toBe('RAW');
    expect(patch06?.presets[0]?.switches.sw1.mandatory).toBe(true);
    expect(patch06?.presets[0]?.knobs.gain.bypassed).toBe(true);
  });

  it('provides accessible text + symbol pill descriptors for all 6 LED states', () => {
    const states = ['green', 'bright-green', 'red', 'dim-red', 'dark', 'amber'] as const;
    for (const state of states) {
      const info = ledBadgeInfo(state);
      expect(info.text.length).toBeGreaterThan(0);
      expect(info.symbol.length).toBeGreaterThan(0);
      expect(info.pillColor).toMatch(/^(green|red|dark|amber)$/);
    }
  });
});
