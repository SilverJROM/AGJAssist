import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['C1','C2','C3','C4','C5','C6'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');

test('command-center reminders fence', async () => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];
  failed.push({ id: 'C5', kind: 'assert' });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  throw new Error('FENCE_ASSERT:C5');
});
