import { timingSafeEqual } from "node:crypto";
import type { Actor } from "@ct/research";
import type { FastifyReply, FastifyRequest } from "fastify";

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Resolves the caller:
 *  - HUMAN_API_TOKEN → human operator (may approve, go live, reset breakers)
 *  - CONTROL_API_TOKEN → Claude / automation (research, paper, request_trade)
 *  - no CONTROL_API_TOKEN configured + loopback → Claude-level access (dev only)
 * Human privileges always require HUMAN_API_TOKEN.
 */
export function resolveActor(req: FastifyRequest, tokens: { control?: string | undefined; human?: string | undefined }): Actor | null {
  const raw = String(req.headers.authorization ?? req.headers["x-api-token"] ?? "").replace(/^Bearer /, "");
  const model = String(req.headers["x-claude-model"] ?? "claude-code");
  const sessionId = String(req.headers["x-claude-session"] ?? req.id);
  if (tokens.human && raw && eq(raw, tokens.human)) {
    return { actor: "human", model: "human", sessionId: String(req.headers["x-operator"] ?? "operator") };
  }
  if (tokens.control && raw && eq(raw, tokens.control)) return { actor: "claude", model, sessionId };
  if (!tokens.control && isLoopback(req.ip)) return { actor: "claude", model, sessionId };
  return null;
}

export function requireActor(req: FastifyRequest, reply: FastifyReply, tokens: { control?: string | undefined; human?: string | undefined }): Actor | null {
  const a = resolveActor(req, tokens);
  if (!a) {
    void reply.code(401).send({ error: "unauthorised" });
    return null;
  }
  return a;
}

export function requireHuman(req: FastifyRequest, reply: FastifyReply, tokens: { control?: string | undefined; human?: string | undefined }): Actor | null {
  const a = resolveActor(req, tokens);
  if (!a || a.actor !== "human") {
    void reply.code(403).send({ error: "this action requires a human operator (HUMAN_API_TOKEN)" });
    return null;
  }
  return a;
}
