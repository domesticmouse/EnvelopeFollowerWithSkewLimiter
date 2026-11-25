import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_REPO_URL,
  HAGIWO_NOTE_URL,
  TUTORIAL_REPO_URL,
  TUTORIAL_SITE_URL,
} from '../src/lib/routes.ts';

const SITE_ROOT = path.resolve(import.meta.dirname, '..');

const ROUTE_CONSTANTS: Record<string, string> = {
  GITHUB_REPO_URL,
  HAGIWO_NOTE_URL,
  TUTORIAL_REPO_URL,
  TUTORIAL_SITE_URL,
};

function parseAstroComponent(relPath: string): {
  frontmatter: string;
  template: string;
  doc: Document;
} {
  const raw = fs.readFileSync(path.join(SITE_ROOT, relPath), 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Expected Astro frontmatter in ${relPath}`);
  }
  const [, frontmatter, template] = match;

  let resolvedTemplate = template;
  for (const [symbol, value] of Object.entries(ROUTE_CONSTANTS)) {
    const importRe = new RegExp(`\\b${symbol}\\b[\\s\\S]*?from\\s+['"]\\.\\./lib/routes\\.ts['"]`);
    if (importRe.test(frontmatter)) {
      resolvedTemplate = resolvedTemplate.replaceAll(`{${symbol}}`, `"${value}"`);
    }
  }

  const doc = new DOMParser().parseFromString(resolvedTemplate, 'text/html');
  return { frontmatter, template, doc };
}

describe('SiteHeader chrome invariants (#36)', () => {
  it('marks header.site-header and dialog#mobile-nav-drawer with data-pagefind-ignore and places Build Tutorial ↗ only in the mobile drawer', () => {
    const { doc } = parseAstroComponent('src/components/SiteHeader.astro');

    const header = doc.querySelector('header.site-header');
    expect(header).not.toBeNull();
    expect(header!.hasAttribute('data-pagefind-ignore')).toBe(true);

    // Desktop header stays single-band with no Build Tutorial link
    const desktopTutorialLinks = [...header!.querySelectorAll('a')].filter(
      (a) =>
        a.getAttribute('href') === TUTORIAL_SITE_URL ||
        (a.textContent ?? '').includes('Build Tutorial'),
    );
    expect(desktopTutorialLinks).toHaveLength(0);

    // Do not alter [data-search-trigger] attributes (handled by #35)
    const searchTrigger = header!.querySelector('[data-search-trigger]');
    expect(searchTrigger).not.toBeNull();
    expect(searchTrigger!.getAttribute('aria-haspopup')).toBeNull();
    expect(searchTrigger!.getAttribute('aria-controls')).toBeNull();

    // Mobile nav drawer is ignored by Pagefind and includes Build Tutorial ↗ alongside GitHub Repository ↗
    const drawer = doc.querySelector('dialog#mobile-nav-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.hasAttribute('data-pagefind-ignore')).toBe(true);

    const drawerLinks = [...drawer!.querySelectorAll('.nav-drawer-links a')];
    const tutorialLink = drawerLinks.find((a) => a.getAttribute('href') === TUTORIAL_SITE_URL);
    expect(tutorialLink).toBeDefined();
    expect(tutorialLink!.getAttribute('target')).toBe('_blank');
    expect(tutorialLink!.getAttribute('rel')).toBe('noopener noreferrer');
    const tutorialText = tutorialLink!.textContent?.replace(/\s+/g, ' ').trim();
    expect(tutorialText).toBe('Build Tutorial ↗');

    const githubLink = drawerLinks.find((a) => a.getAttribute('href') === GITHUB_REPO_URL);
    expect(githubLink).toBeDefined();
    expect(githubLink!.getAttribute('target')).toBe('_blank');
    expect(githubLink!.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('SiteFooter chrome invariants (#36)', () => {
  it('marks footer.site-footer with data-pagefind-ignore, adds Build Tutorial ↗ in .footer-nav, and uses route constants in .footer-meta', () => {
    const { template, doc } = parseAstroComponent('src/components/SiteFooter.astro');

    const footer = doc.querySelector('footer.site-footer');
    expect(footer).not.toBeNull();
    expect(footer!.hasAttribute('data-pagefind-ignore')).toBe(true);

    const footerNavLinks = [...footer!.querySelectorAll('.footer-nav a')];
    const tutorialNavLink = footerNavLinks.find((a) => a.getAttribute('href') === TUTORIAL_SITE_URL);
    expect(tutorialNavLink).toBeDefined();
    expect(tutorialNavLink!.getAttribute('target')).toBe('_blank');
    expect(tutorialNavLink!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(tutorialNavLink!.textContent?.trim()).toBe('Build Tutorial ↗');

    const githubNavLink = footerNavLinks.find((a) => a.getAttribute('href') === GITHUB_REPO_URL);
    expect(githubNavLink).toBeDefined();

    // .footer-meta links resolve to HAGIWO_NOTE_URL and TUTORIAL_REPO_URL via route constants (not hardcoded URLs)
    expect(template).not.toContain(HAGIWO_NOTE_URL);
    expect(template).not.toContain(TUTORIAL_REPO_URL);

    const footerMetaLinks = [...footer!.querySelectorAll('.footer-meta a')];
    const hagiwoLink = footerMetaLinks.find((a) => a.getAttribute('href') === HAGIWO_NOTE_URL);
    expect(hagiwoLink).toBeDefined();
    expect(hagiwoLink!.getAttribute('target')).toBe('_blank');
    expect(hagiwoLink!.getAttribute('rel')).toBe('noopener noreferrer');

    const tutorialRepoLink = footerMetaLinks.find(
      (a) => a.getAttribute('href') === TUTORIAL_REPO_URL,
    );
    expect(tutorialRepoLink).toBeDefined();
    expect(tutorialRepoLink!.getAttribute('target')).toBe('_blank');
    expect(tutorialRepoLink!.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('/origin/ Curated Page invariants (#36)', () => {
  it('replaces stale extraction cards with live 9-stage Build Tutorial cards and updates the lead paragraph', () => {
    const { template, doc } = parseAstroComponent('src/pages/origin.astro');

    // No hardcoded copies of route constants or stale archival SHA/prompt-count strings
    expect(template).not.toContain(HAGIWO_NOTE_URL);
    expect(template).not.toContain(TUTORIAL_REPO_URL);
    expect(template).not.toContain(TUTORIAL_SITE_URL);
    for (const stale of [
      '4a02c46',
      '16 documented',
      'build prompts',
      'Archival Extraction Repo',
      'Live Extraction Docs',
      '2026-11-18',
      'extracted circuit documentation',
    ]) {
      expect(template).not.toContain(stale);
    }

    // Lead paragraph frames domesticmouse/EnvelopeFollower as the live companion Build Tutorial
    const lead = doc.querySelector('.curated-hero .curated-lead');
    expect(lead).not.toBeNull();
    const leadText = lead!.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(leadText).toContain('Build Tutorial');
    expect(leadText).toContain('domesticmouse/EnvelopeFollower');

    // HAGIWO primary writeup card uses HAGIWO_NOTE_URL
    const cards = [...doc.querySelectorAll('.curated-cards-stack a.curated-link-card')];
    const hagiwoCard = cards.find((a) => a.getAttribute('href') === HAGIWO_NOTE_URL);
    expect(hagiwoCard).toBeDefined();

    // TUTORIAL_REPO_URL card
    const repoCard = cards.find((a) => a.getAttribute('href') === TUTORIAL_REPO_URL);
    expect(repoCard).toBeDefined();
    expect(repoCard!.getAttribute('target')).toBe('_blank');
    expect(repoCard!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(repoCard!.querySelector('.curated-card-kicker')?.textContent?.trim()).toBe(
      'Build Tutorial Repo · GitHub ↗',
    );
    expect(repoCard!.querySelector('.curated-card-title')?.textContent?.trim()).toBe(
      'domesticmouse/EnvelopeFollower',
    );
    const repoMeta = repoCard!.querySelector('.curated-card-meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(repoMeta).toContain('9-stage');
    expect(repoMeta).toContain('ENV / SKEW');
    expect(repoMeta).toContain('Build Tutorial');

    // TUTORIAL_SITE_URL card
    const siteCard = cards.find((a) => a.getAttribute('href') === TUTORIAL_SITE_URL);
    expect(siteCard).toBeDefined();
    expect(siteCard!.getAttribute('target')).toBe('_blank');
    expect(siteCard!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(siteCard!.querySelector('.curated-card-kicker')?.textContent?.trim()).toBe(
      'Live Build Tutorial · GitHub Pages ↗',
    );
    expect(siteCard!.querySelector('.curated-card-title')?.textContent?.trim()).toBe(
      'ENV / SKEW Build Tutorial',
    );
    const siteMeta = siteCard!.querySelector('.curated-card-meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(siteMeta).toContain('9-stage');
    expect(siteMeta).toContain('Build Tutorial');

    // Lightbox trigger remains intact
    expect(doc.querySelector('[data-origin-lightbox]')).not.toBeNull();
  });
});
