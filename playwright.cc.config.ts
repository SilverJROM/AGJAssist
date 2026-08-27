import { defineConfig, devices } from '@playwright/test';

// Dedicated config for the command-center fence journeys' 'cc' project.
// Split out from playwright.config.ts because TestProject has no webServer
// field (only TestConfig does) — a webServer nested inside a `projects[]`
// entry is silently ignored, so this project needs its own top-level one to
// actually boot the real Fastify server on an isolated temp-copy DB.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  projects: [
    { name: 'cc', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3210' } },
  ],
  webServer: {
    command: 'node scripts/cc-run-isolated.mjs --serve',
    url: 'http://localhost:3210/index.html',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
