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
          // Each test builds a fresh database from the whole schema, which grows with every module. When that setup
          // runs past the default 10 s the hook fails mid-way and the next test inherits half a database, so the real
          // cause ("hook timed out") arrives buried under errors like "user email already exists" in unrelated files.
          hookTimeout: 60_000,
          // The same cost lands inside a test that walks several mutations, so it gets the same room as the hook.
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['{app,components,lib}/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup-dom.ts'],
          // jsdom is held at 30.0.1 in package.json: on 30.1.0 a Radix dropdown never opens under user-event, so the
          // account menu and the project status menu cannot be driven in a test. The menu markup and its roles are
          // fine — rendered on its own it is found by getByRole — so this is the test environment, not the app.
          // Worth retrying whenever jsdom or user-event moves again.
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
