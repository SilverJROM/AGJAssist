import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createAuthMiddleware, requireOwner } from '../../src/auth/auth-middleware.js';
import { AuthService } from '../../src/auth/auth-service.js';
import { AgentAssignmentService } from '../../src/services/agent-assignment-service.js';
import { CoordinatorLaunchService } from '../../src/services/coordinator-launch-service.js';
import { TmuxService } from '../../src/tmux/tmux-service.js';
import { registerAgentRoutes } from '../../src/api/routes/agent-routes.js';

// Minimal test for B4 send endpoint (Fastify inject, owner auth, tmux spy, no real send)
describe('B4 /api/projects/:id/agent-message', () => {
  let app: FastifyInstance;
  let tmux: any;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    tmux = { send: vi.fn().mockResolvedValue({ message: 'sent', blocked: false }) };

    // Minimal auth service that satisfies middleware for owner
    const authService = {
      verifyToken: (t: string) => (t && t.includes('owner') ? { id: 1, role: 'owner', username: 'test' } : null)
    } as any as AuthService;

    // Dummies for the register (not used by the new route)
    const assignment = {} as any as AgentAssignmentService;
    const launch = undefined as any as CoordinatorLaunchService;

    // Register with tmux (the B4 addition)
    registerAgentRoutes(app, authService, assignment, launch, tmux as any as TmuxService);

    await app.ready();
  });

  it('POST sends via tmux-service to agj-os-<pid> and requires owner auth (inject)', async () => {
    // owner token passes requireOwner
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/42/agent-message',
      headers: { authorization: 'Bearer owner-token' },
      payload: { text: 'hello from B4 test', target: 'agj-os-42:0.0' }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.runId).toBe('agj-os-42');
    expect(tmux.send).toHaveBeenCalledTimes(1);
    expect(tmux.send).toHaveBeenCalledWith('agj-os-42:0.0', 'hello from B4 test', true);
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
      payload: { text: '   ' }
    });
    expect(resBad.statusCode).toBe(400);
  });
});
