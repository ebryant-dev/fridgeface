import { defineConfig } from 'vite';
import { authorServer } from './dev/author-server.ts';

export default defineConfig({
  plugins: [authorServer()], // dev server only (apply: 'serve'): never part of a build
  build: {
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'fridgeface.js' },
  },
});
