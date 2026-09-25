import { defineConfig } from '@playwright/test';

// testMatch admits every xmachines-*.spec.ts journey (fence checkpoints
// plus downstream D/E rows). command-center-* and terminal-ux-* stay out
// because they do not begin xmachines-. Self-test fixtures live under
// e2e/fixtures/ and are ignored on a suite run. Playwright still applies
// testIgnore to an explicit CLI path, so skip it only when that path is
// itself a fixture (the harness spawn).
const explicitFixture = process.argv.some((arg) => /(?:^|[\\/])fixtures[\\/]/.test(arg));

export default defineConfig({
  testDir: 'e2e',
  testMatch: /xmachines-.*\.spec\.ts$/,
  testIgnore: explicitFixture ? [] : /fixtures\//,
  projects: [
    {
      name: 'xmachines',
      use: {
        baseURL: process.env.FENCE_ORIGIN || 'http://localhost:3210',
        headless: true,
      }
    }
  ]
});
