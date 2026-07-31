import { defineConfig } from 'vite';

// SPA app: dev server falls back to index.html for deep routes
// (history routing); production fallback lives in vercel.json.
export default defineConfig({
  server: { port: 8000 },
  build: { outDir: 'dist' },
});
