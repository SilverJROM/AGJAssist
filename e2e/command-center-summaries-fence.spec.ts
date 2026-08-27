import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['E1','E2','E3','F1','F2','F3'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');

test('command-center summaries fence', async () => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];
  failed.push({ id: 'E1', kind: 'assert' });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  throw new Error('FENCE_ASSERT:E1');
});
