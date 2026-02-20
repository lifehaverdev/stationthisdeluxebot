import { defineConfig } from 'vite';

const BACKEND = 'http://localhost:4000';

export default defineConfig({
  appType: 'spa',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    // Ensure all hostnames (app.localhost, localhost) get the SPA index.html
    origin: 'http://localhost:5173',
    proxy: {
      // API calls
      '/api': BACKEND,
      // WebSocket
      '/ws': { target: BACKEND, ws: true },
      // Sandbox ESM modules (old vanilla code loaded at runtime)
      '/sandbox': BACKEND,
      // Sandbox CSS
      '/index.css': BACKEND,
      // Auth + other JS served from public/
      '/js': BACKEND,
      // Images and static assets
      '/images': BACKEND,
      // Spell pages
      '/spells': BACKEND,
      // Auth endpoints (logout, landing)
      '/logout': BACKEND,
      '/landing': BACKEND,
      // Referral links
      '/referral': BACKEND,
    }
  }
});
