import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createAuthMiddleware, requireOwner } from '../../src/auth/auth-middleware.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { AgentAssignmentService } from '../../src/services/agent-assignment-service.js';
import { CoordinatorLaunchService } from '../../src/services/coordinator-launch-service.js';
import { TmuxService } from '../../src/tmux/tmux-service.js';
import { registerAgentRoutes } from '../../src/api/routes/agent-routes.js';
import { SafetyService } from '../../src/services/safety-service.js';
import { ProjectService } from '../../src/services/project-service.js';

// B4 send test (Fastify inject, owner auth, REAL TmuxService method mock). Asserts sendAndSubmit (not fake send) so it fails on wrong method (GAP-2).
describe('B4 /api/projects/:id/agent-message', () => {
  let app: FastifyInstance;
  let tmux: any;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    tmux = { sendAndSubmit: vi.fn().mockResolvedValue(true) };

    // Minimal auth service that satisfies middleware for owner
    const authService = {
      verifyToken: (t: string) => (t && t.includes('owner') ? { id: 1, role: 'owner', username: 'test' } : null)
    } as any as AuthService;

    // Dummies for the register (not used by the new route)
    const assignment = {} as any as AgentAssignmentService;
    const launch = undefined as any as CoordinatorLaunchService;
    const projectDummy = {} as any as ProjectService;
    // Safety mock: blocks on obvious dangerous for the new B6 tests; safe otherwise
    const safety = {
      checkCommand: vi.fn((cmd: string) => ({
        blocked: /rm -rf|danger|evil|sudo rm/i.test(cmd),
        pattern: /rm -rf|danger|evil/i.test(cmd) ? ({ pattern: 'dangerous' } as any) : null
      }))
    } as any as SafetyService;

    // Register ... + project + safety (B6 spawn guards now apply to agent-message too)
    registerAgentRoutes(app, authService, assignment, launch, tmux as any as TmuxService, projectDummy, safety);

    await app.ready();
  });

  it('POST sends via tmux-service to agj-os-<pid> and requires owner auth (inject)', async () => {
    // owner token passes requireOwner
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'hello from B4 test', target: 'agj-os-42:0.0' },
      remoteAddress: '127.0.0.1'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.runId).toBe('agj-os-42');
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit).toHaveBeenCalledWith(expect.stringContaining('agj-os-42'), 'hello from B4 test');
  });

  it('rejects non-owner (401/403 range) and missing text (400)', async () => {
    const resNoOwner = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer guest-token' },
      payload: { text: 'x' }
    });
    expect(resNoOwner.statusCode).toBeGreaterThanOrEqual(400);
    expect(resNoOwner.statusCode).toBeLessThan(500);

    const resBad = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: '   ' },
      remoteAddress: '127.0.0.1'
    });
    expect(resBad.statusCode).toBe(400);
  });

  // B6 red-team iter1 additions: non-loopback 403; foreign target rejected; dangerous blocked by safety; legit still works
  it('non-loopback agent-message rejected with 403 (b)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'safe message' },
      remoteAddress: '10.0.0.5'
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('localhost');
  });

  it('foreign target is rejected (not trusted/used) (c)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'hi', target: 'other-session:0.0' },
      remoteAddress: '127.0.0.1'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('target must be the project');
    // ensure sendAndSubmit was NOT called with foreign
    expect(tmux.sendAndSubmit).not.toHaveBeenCalledWith(expect.stringContaining('other-session'), expect.any(String));
  });

  it('dangerous payload is blocked by safetyService pattern check (c)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'rm -rf /' },
      remoteAddress: '127.0.0.1'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('blocked by safety pattern');
  });

  it('legit owner + loopback + safe text + own target still works (R14)', async () => {
    // reset call count for this it
    tmux.sendAndSubmit.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'legit safe chat to agent', target: 'agj-os-42:0.0' },
      remoteAddress: '127.0.0.1'
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.runId).toBe('agj-os-42');
    expect(tmux.sendAndSubmit).toHaveBeenCalledWith(expect.stringContaining('agj-os-42'), 'legit safe chat to agent');
  });
});
