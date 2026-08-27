import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.FENCE_PORT || 3210);

// Dedicated config for the command-center fence journeys' 'cc' project.
// Split out from playwright.config.ts because TestProject has no webServer
// field (only TestConfig does) — a webServer nested inside a `projects[]`
// entry is silently ignored, so this project needs its own top-level one to
// actually boot the real Fastify server on an isolated temp-copy DB.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  projects: [
    { name: 'cc', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` } },
  ],
  webServer: {
    command: 'node scripts/cc-run-isolated.mjs --serve',
    url: `http://localhost:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
