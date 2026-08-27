import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

describe('overmind removal services', () => {
  const cwd = process.cwd();
  const paths = [
    'src/services/overmind-service.ts',
    'src/services/overmind-watcher.ts',
    'src/services/overmind-brain.ts',
    'src/services/overmind-notifications.ts',
    'src/services/overmind'
  ];

  it('overmind services and directory removed', () => {
    for (const p of paths) {
      expect(existsSync(join(cwd, p))).toBe(false);
    }
  });
});
