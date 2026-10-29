import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: { re2js: fileURLToPath(new URL('./src/vendor/re2js-stub.js', import.meta.url)) }
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    // Firebase ändert sich selten: eigener Chunk bleibt bei App-Updates im Cache
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => (/node_modules\/(firebase|@firebase|idb)\//.test(id) ? 'firebase' : undefined)
      }
    }
  },
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
