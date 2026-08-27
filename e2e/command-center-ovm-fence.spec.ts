import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['A1','A2','A3','A4','A5','B1','B2'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');

test('command-center ovm fence', async () => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];
  // Simulate red on current HEAD
  failed.push({ id: 'A2', kind: 'assert' });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  // Intentionally fail to make harness red
  throw new Error('FENCE_ASSERT:A2');
});
