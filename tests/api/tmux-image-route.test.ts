import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTmuxRoutes } from '../../src/api/routes/tmux-routes.js';
import type { AuthService } from '../../src/auth/auth-service.js';

// GET /api/tmux/image — the terminal chat's tap-to-view for image paths an agent prints.
describe('GET /api/tmux/image', () => {
  let app: FastifyInstance;
  let dir: string;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const owner = { authorization: 'Bearer owner-token' };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agj-img-'));
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'out', 'shot.png'), png);
    fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.symlinkSync('/etc/hostname', path.join(dir, 'escape.png'));

    app = Fastify({ logger: false });
    const authService = {
      verifyToken: (t: string) => (t.includes('owner')
        ? { id: 1, role: 'owner', username: 'o' }
        : t.includes('viewer') ? { id: 2, role: 'viewer', username: 'v' } : null),
    } as unknown as AuthService;
    const tmux = { paneCurrentPath: async (t: string) => (t === 'agent:0.0' ? dir : null) };
    const noop = {} as never;
    registerTmuxRoutes(app, authService, tmux as never, noop, noop, noop, noop);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const get = (query: string, headers = owner) =>
    app.inject({ method: 'GET', url: `/api/tmux/image?${query}`, headers });

  it('serves an absolute image path with its image content type', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'out', 'shot.png')));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(png)).toBe(true);
  });

  it('resolves a relative path against the pane cwd', async () => {
    const res = await get('path=out%2Fshot.png&target=agent%3A0.0');
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(png)).toBe(true);
  });

  it('refuses non-owners', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'out', 'shot.png')), { authorization: 'Bearer viewer-token' });
    expect(res.statusCode).toBe(403);
  });

  it('refuses non-image types, including svg', async () => {
    expect((await get('path=' + encodeURIComponent(path.join(dir, 'icon.svg')))).statusCode).toBe(400);
    expect((await get('path=%2Fetc%2Fpasswd')).statusCode).toBe(400);
  });

  it('refuses an image path whose real target is outside home and /tmp', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'escape.png')));
    expect(res.statusCode).toBe(403);
  });

  it('404s a missing image', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'nope.png')));
    expect(res.statusCode).toBe(404);
  });
});
