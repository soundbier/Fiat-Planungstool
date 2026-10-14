import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 800 },
  plugins: [
    VitePWA({
      // Manifest liegt in public/, Registrierung erfolgt in src/pwa.js (mit Update-Hinweis)
      manifest: false,
      injectRegister: false,
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  test: { environment: 'node', include: ['test/**/*.test.js'] }
});
