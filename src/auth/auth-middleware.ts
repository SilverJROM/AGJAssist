import { FastifyRequest, FastifyReply } from "fastify";
import { AuthService, SessionUser } from "./auth-service.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: SessionUser;
  }
}

export function createAuthMiddleware(authService: AuthService) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = header.slice(7);
    const user = authService.verifyToken(token);

    if (!user) {
      reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    request.sessionUser = user;
  };
}

export function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
): void {
  if (request.sessionUser?.role !== "owner") {
    reply.code(403).send({ error: "Owner role required" });
    return;
  }
  done();
}
