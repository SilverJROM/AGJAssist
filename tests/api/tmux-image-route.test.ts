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
    const tmux = { isRemote: () => false, paneCurrentPath: async (t: string) => (t === 'agent:0.0' ? dir : null) };
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

// GET /api/tmux/doc — the terminal chat's tap-to-view for PDF / Markdown / Word files.
describe('GET /api/tmux/doc', () => {
  let app: FastifyInstance;
  let dir: string;
  const fixtures = path.resolve(__dirname, '../fixtures/docs');
  const owner = { authorization: 'Bearer owner-token' };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agj-doc-'));
    for (const f of ['sample.pdf', 'sample.md', 'sample.docx', 'legacy.doc']) {
      fs.copyFileSync(path.join(fixtures, f), path.join(dir, f));
    }
    fs.writeFileSync(path.join(dir, 'notes.exe'), 'MZ');
    fs.symlinkSync('/etc/hostname', path.join(dir, 'escape.md'));

    app = Fastify({ logger: false });
    const authService = {
      verifyToken: (t: string) => (t.includes('owner')
        ? { id: 1, role: 'owner', username: 'o' }
        : t.includes('viewer') ? { id: 2, role: 'viewer', username: 'v' } : null),
    } as unknown as AuthService;
    const tmux = { isRemote: () => false, paneCurrentPath: async (t: string) => (t === 'agent:0.0' ? dir : null) };
    const noop = {} as never;
    registerTmuxRoutes(app, authService, tmux as never, noop, noop, noop, noop);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const get = (query: string, headers = owner) =>
    app.inject({ method: 'GET', url: `/api/tmux/doc?${query}`, headers });

  it('serves a PDF as application/pdf bytes, never inline HTML', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'sample.pdf')));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns Markdown as JSON text (relative to the pane cwd)', async () => {
    const res = await get('path=sample.md&target=agent%3A0.0');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json();
    expect(body.kind).toBe('markdown');
    expect(body.text).toContain('# Viewer test');
  });

  it('converts .docx to HTML inside JSON', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'sample.docx')));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('docx');
    expect(body.html).toContain('<h1>Word viewer test</h1>');
    expect(body.html).toContain('<strong>Bold run</strong>');
  });

  it('serves legacy .doc as a download', async () => {
    const res = await get('path=' + encodeURIComponent(path.join(dir, 'legacy.doc')));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/msword');
  });

  it('refuses non-owners, unsupported types, escapes, and missing files', async () => {
    expect((await get('path=' + encodeURIComponent(path.join(dir, 'sample.md')), { authorization: 'Bearer viewer-token' })).statusCode).toBe(403);
    expect((await get('path=' + encodeURIComponent(path.join(dir, 'notes.exe')))).statusCode).toBe(400);
    expect((await get('path=' + encodeURIComponent(path.join(dir, 'escape.md')))).statusCode).toBe(403);
    expect((await get('path=' + encodeURIComponent(path.join(dir, 'gone.pdf')))).statusCode).toBe(404);
  });
});
