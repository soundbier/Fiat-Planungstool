import { defineConfig, devices } from '@playwright/test';

// Smoke-Tests der Oberfläche gegen Auth- und Firestore-Emulator: npm run test:e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4174', locale: 'de-DE', timezoneId: 'Europe/Berlin', ...devices['iPhone 13'], browserName: 'chromium' },
  webServer: { command: 'npx vite preview --outDir dist-e2e --port 4174 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4174', reuseExistingServer: false }
});
