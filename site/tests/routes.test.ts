import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ROUTES,
  HAGIWO_NOTE_URL,
  PRIMARY_NAV_ITEMS,
  SITE_BASE,
  SITE_ORIGIN,
  TUTORIAL_REPO_URL,
  TUTORIAL_SITE_URL,
  isNavSectionActive,
  normalizeRoutePath,
  withBase,
} from '../src/lib/routes.ts';

describe('routes registry and base-path helpers', () => {
  it('defines the locked GitHub Pages origin and base path', () => {
    expect(SITE_ORIGIN).toBe('https://domesticmouse.github.io');
    expect(SITE_BASE).toBe('/EnvelopeFollowerWithSkewLimiter');
  });

  it('exports canonical external lineage and companion Build Tutorial URLs', () => {
    expect(HAGIWO_NOTE_URL).toBe('https://note.com/solder_state/n/n110e9ba066b3?hl=en');
    expect(TUTORIAL_REPO_URL).toBe('https://github.com/domesticmouse/EnvelopeFollower');
    expect(TUTORIAL_SITE_URL).toBe('https://domesticmouse.github.io/EnvelopeFollower/');
  });

  it('prefixes internal paths and passthrough assets with SITE_BASE while preserving hashes', () => {
    expect(withBase('/')).toBe('/EnvelopeFollowerWithSkewLimiter/');
    expect(withBase('/patches/')).toBe('/EnvelopeFollowerWithSkewLimiter/patches/');
    expect(withBase('images/panel_front.png')).toBe(
      '/EnvelopeFollowerWithSkewLimiter/images/panel_front.png',
    );
    expect(withBase('/hardware/#panel')).toBe(
      '/EnvelopeFollowerWithSkewLimiter/hardware/#panel',
    );
    expect(withBase('/EnvelopeFollowerWithSkewLimiter/build/')).toBe(
      '/EnvelopeFollowerWithSkewLimiter/build/',
    );
    expect(withBase('#main-content')).toBe('#main-content');
  });

  it('contains all 25 canonical HTML routes from the implementation spec', () => {
    expect(CANONICAL_ROUTES).toHaveLength(25);
    expect(new Set(CANONICAL_ROUTES).size).toBe(25);

    const expectedRoutes = [
      '/',
      '/hardware/',
      '/origin/',
      '/downloads/',
      '/specs/',
      '/specs/design-spec/',
      '/specs/base-circuit/',
      '/specs/circuit-review/',
      '/specs/panel-svg-spec/',
      '/patches/',
      '/patches/01-sidechain-ducking/',
      '/patches/02-auto-wah-envelope-filter/',
      '/patches/03-compression-expansion-gating/',
      '/patches/04-ducking-and-blooming-fx/',
      '/patches/05-cross-modulation-push-pull/',
      '/patches/06-audio-rate-slew-waveshaping/',
      '/patches/07-asymmetric-portamento-slides/',
      '/patches/08-gate-to-ar-envelope-and-slewed-mod/',
      '/build/',
      '/build/01-main-board-ordering/',
      '/build/01b-front-panel-ordering/',
      '/build/02-pcba-part-alignment/',
      '/build/03-tayda-ordering/',
      '/build/04-hand-assembly/',
      '/build/05-board-bringup/',
    ];

    for (const route of expectedRoutes) {
      expect(CANONICAL_ROUTES).toContain(route);
    }
  });

  it('exposes the five audience-ordered primary navigation links', () => {
    expect(PRIMARY_NAV_ITEMS).toEqual([
      { label: 'Patches', href: '/patches/' },
      { label: 'Build', href: '/build/' },
      { label: 'Hardware', href: '/hardware/' },
      { label: 'Origin', href: '/origin/' },
      { label: 'Downloads', href: '/downloads/' },
    ]);
  });

  it('matches active navigation sections across exact, nested, and base-prefixed paths', () => {
    expect(isNavSectionActive('/', '/patches/')).toBe(false);
    expect(isNavSectionActive('/', '/')).toBe(true);
    expect(isNavSectionActive('/patches/', '/patches/')).toBe(true);
    expect(isNavSectionActive('/patches/01-sidechain-ducking/', '/patches/')).toBe(true);
    expect(
      isNavSectionActive('/EnvelopeFollowerWithSkewLimiter/build/02-pcba-part-alignment/', '/build/'),
    ).toBe(true);
    expect(isNavSectionActive('/hardware/#schematic', '/hardware/')).toBe(true);
    expect(isNavSectionActive('/specs/design-spec/', '/hardware/')).toBe(false);
    expect(normalizeRoutePath('/EnvelopeFollowerWithSkewLimiter/origin#top')).toBe('/origin/');
  });
});
