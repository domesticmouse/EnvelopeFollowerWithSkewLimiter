import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkMath from 'remark-math';
import { SITE_BASE, SITE_ORIGIN } from './src/lib/routes.ts';
import { staticPassthroughIntegration } from './src/lib/static-passthrough.ts';
import { rehypeSingleSource } from './src/plugins/rehype-single-source.ts';
import { remarkPromoteDoubleDollarMath } from './src/plugins/remark-double-dollar-math.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  site: SITE_ORIGIN,
  base: SITE_BASE,
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid'],
    },
    shikiConfig: {
      theme: 'github-dark',
    },
    processor: unified({
      gfm: true,
      remarkPlugins: [remarkMath, remarkPromoteDoubleDollarMath],
      rehypePlugins: [
        rehypeRaw,
        [rehypeKatex, { strict: false }],
        [rehypeSingleSource, { repoRoot: REPO_ROOT }],
      ],
    }),
  },
  integrations: [staticPassthroughIntegration()],
  vite: {
    server: {
      fs: {
        allow: ['..'],
      },
    },
  },
});
