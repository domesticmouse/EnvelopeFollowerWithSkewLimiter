import path from 'node:path';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import {
  BUILD_CHECKLIST_FILES,
  MD_TO_ROUTE,
  PATCH_GUIDE_FILES,
  REFERENCE_SPEC_FILES,
} from './lib/content-manifest.ts';

function normalizeEntryId(entry: string): string {
  const posix = entry.replaceAll('\\', '/').replace(/^\.\//, '');
  const route = MD_TO_ROUTE[posix];
  if (route) {
    const clean = route.replace(/^\/|\/$/g, '');
    const segments = clean.split('/');
    // Preserve 'index' for directory hubs (patches/README.md -> index, checklists/README.md -> index)
    if (posix.endsWith('/README.md')) {
      return 'index';
    }
    return segments[segments.length - 1] ?? posix;
  }
  return path.posix.basename(posix, '.md');
}

const frontmatterFreeSchema = z.object({}).loose();

const referenceSpecs = defineCollection({
  loader: glob({
    base: '..',
    pattern: [...REFERENCE_SPEC_FILES],
    generateId: ({ entry }) => normalizeEntryId(entry),
  }),
  schema: frontmatterFreeSchema,
});

const buildChecklists = defineCollection({
  loader: glob({
    base: '..',
    pattern: [...BUILD_CHECKLIST_FILES],
    generateId: ({ entry }) => normalizeEntryId(entry),
  }),
  schema: frontmatterFreeSchema,
});

const patchGuides = defineCollection({
  loader: glob({
    base: '..',
    pattern: [...PATCH_GUIDE_FILES],
    generateId: ({ entry }) => normalizeEntryId(entry),
  }),
  schema: frontmatterFreeSchema,
});

export const collections = {
  referenceSpecs,
  buildChecklists,
  patchGuides,
};
