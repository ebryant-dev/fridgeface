import { defineConfig } from 'vitest/config';
import { authorServer } from './dev/author-server.ts';

export default defineConfig({
  test: { exclude: ['node_modules/**', 'dist/**', 'site-dist/**', '.playwright-mcp/**'] }, // scratch copies live in .playwright-mcp/
  plugins: [authorServer()], // dev server only (apply: 'serve'): never part of a build
  build: {
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'fridgeface.js' },
  },
});
