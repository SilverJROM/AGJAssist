import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The 'cc' project (command-center fence journeys) lives in its own config —
    // playwright.cc.config.ts — because TestProject has no webServer field (only
    // TestConfig does); a per-project webServer entry here is silently ignored and
    // every run falls through to this file's static-server.mjs webServer below.
  ],
  use: { baseURL: 'http://localhost:3210' },
  // reuseExistingServer:false so the proof always boots OUR shipped-app static server (e2e/static-server.mjs)
  // and is never hijacked by a foreign dev server (e.g. `npx serve`, which 301-redirects /index.html and drops the
  // ?b4smoke=1 query the render proof depends on). A clean checkout must serve the real shipped src/web/public.
  webServer: { command: 'node e2e/static-server.mjs', url: 'http://localhost:3210/index.html', reuseExistingServer: false, timeout: 30000 },
});
