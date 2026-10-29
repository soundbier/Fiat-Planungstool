import { defineConfig } from 'vitest/config';

// Rule-Tests gegen den Firestore-Emulator: npm run test:rules
export default defineConfig({
  test: { environment: 'node', include: ['test-rules/**/*.test.js'], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false }
});
