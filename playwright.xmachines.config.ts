import { defineConfig } from '@playwright/test';

// testDir/testMatch are scoped narrowly to the xmachines-fence-*.spec.ts
// checkpoints so a fence run never accidentally collects the unrelated
// command-center / terminal-ux specs that also live under e2e/.
export default defineConfig({
  testDir: 'e2e',
  testMatch: /xmachines-fence-.*\.spec\.ts$/,
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
