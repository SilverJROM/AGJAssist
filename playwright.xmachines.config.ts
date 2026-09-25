import { defineConfig } from '@playwright/test';

export default defineConfig({
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
