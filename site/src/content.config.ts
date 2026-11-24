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
import { toPosixPath } from './lib/static-passthrough.ts';

function normalizeEntryId(entry: string): string {
  const posix = toPosixPath(entry);
  if (posix.endsWith('/README.md')) {
    return 'index';
  }
  const route = MD_TO_ROUTE[posix];
  if (route) {
    const clean = route.replace(/^\/|\/$/g, '');
    const segments = clean.split('/');
    return segments[segments.length - 1] ?? posix;
  }
  return path.posix.basename(posix, '.md');
}

const frontmatterFreeSchema = z.object({}).strict();

function createMarkdownCollection(pattern: readonly string[]) {
  return defineCollection({
    loader: glob({
      base: '..',
      pattern: [...pattern],
      generateId: ({ entry }) => normalizeEntryId(entry),
    }),
    schema: frontmatterFreeSchema,
  });
}

export const collections = {
  referenceSpecs: createMarkdownCollection(REFERENCE_SPEC_FILES),
  buildChecklists: createMarkdownCollection(BUILD_CHECKLIST_FILES),
  patchGuides: createMarkdownCollection(PATCH_GUIDE_FILES),
};
