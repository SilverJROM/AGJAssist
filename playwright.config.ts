import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:3210' },
  webServer: { command: 'node e2e/static-server.mjs', url: 'http://localhost:3210/index.html', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
