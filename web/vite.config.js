import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  // The Express server serves ../public; `npm run dev` proxies the API to it.
  build: { outDir: path.resolve(here, '..', 'public'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
