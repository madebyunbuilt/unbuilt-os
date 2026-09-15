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
          // Screen tests type into real forms; on a busy machine the 5 s default is too tight.
          testTimeout: 20_000,
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
