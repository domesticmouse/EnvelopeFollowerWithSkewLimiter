import { defineConfig } from 'astro/config';
import { SITE_BASE, SITE_ORIGIN } from './src/lib/routes.ts';
import { staticPassthroughIntegration } from './src/lib/static-passthrough.ts';

export default defineConfig({
  site: SITE_ORIGIN,
  base: SITE_BASE,
  trailingSlash: 'always',
  build: {
    format: 'directory',
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
