import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'convex',
          environment: 'edge-runtime',
          include: ['convex/**/*.test.ts'],
          server: { deps: { inline: ['convex-test'] } },
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup-dom.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'repo',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
    ],
  },
});
