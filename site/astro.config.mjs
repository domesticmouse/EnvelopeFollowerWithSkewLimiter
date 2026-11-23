import { defineConfig } from 'astro/config';
import { staticPassthroughIntegration } from './src/lib/static-passthrough.ts';

export default defineConfig({
  site: 'https://domesticmouse.github.io',
  base: '/EnvelopeFollowerWithSkewLimiter',
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
