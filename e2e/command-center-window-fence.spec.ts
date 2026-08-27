import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['G1','G2','G3','H1','H2','H3','I1','I2','J1','J2'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');

test('command-center window fence', async () => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];
  failed.push({ id: 'G3', kind: 'assert' });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  throw new Error('FENCE_ASSERT:G3');
});
