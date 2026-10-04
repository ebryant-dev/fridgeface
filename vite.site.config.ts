import { defineConfig } from 'vite';

// Standalone site: a static build of index.html (the toy full-screen) into site-dist/.
// embed.html and the dev-only author server are deliberately not part of it.
export default defineConfig({
  build: {
    outDir: 'site-dist',
    emptyOutDir: true,
    rollupOptions: { input: 'index.html' },
  },
  preview: { port: 4173 },
});
