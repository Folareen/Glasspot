import fp from "fastify-plugin";
import fjwt, { FastifyJWT, JWT } from "@fastify/jwt";
import { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import env from "@/config/env";
import db, { users } from "@/db";

/** True if this access token's tokenVersion claim matches the user's current value — false for a stale/revoked token (logout, password reset, refresh-reuse) even though its signature still verifies, and false if the user no longer exists. See db/schema/users.ts's tokenVersion comment. */
async function isTokenVersionCurrent(userId: string, tokenVersion: number): Promise<boolean> {
  const [user] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId));
  return user !== undefined && user.tokenVersion === tokenVersion;
}

/**
 * Registers @fastify/jwt and adds: `request.jwt` (the signer/verifier, so services can call
 * `.sign()` directly instead of via `reply.jwtSign`), `server.authenticate` (preHandler that
 * verifies the Authorization header and populates `request.user`, 401s if missing/invalid), and
 * `server.optionalAuthenticate` (same but leaves `request.user` unset instead of rejecting, for
 * routes that behave differently when logged in but must also work anonymously).
 */
export default fp(async (server) => {
  server.register(fjwt, {
    secret: env.JWT_SECRET as string,
    sign: {
      // Access tokens are short-lived by design — the refresh token is
      // what carries session longevity (see lib/tokens.ts).
      expiresIn: "15m",
      algorithm: "HS256",
    },
    // Pinned explicitly rather than left to fast-jwt's default — a shared-secret HMAC scheme like
    // this one must never accept a token claiming a different algorithm in its header (classic
    // "alg confusion"/"none" attack surface), regardless of what the library defaults to today.
    verify: {
      algorithms: ["HS256"],
    },
  });

  server.addHook("preHandler", (request, _reply, next) => {
    request.jwt = server.jwt;
    return next();
  });

  server.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
      if (!(await isTokenVersionCurrent(request.user.sub, request.user.tokenVersion))) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
    }
  );

  server.decorate(
    "optionalAuthenticate",
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        // No/invalid token — proceed anonymously, request.user stays unset.
        return;
      }
      if (!(await isTokenVersionCurrent(request.user.sub, request.user.tokenVersion))) {
        // Stale/revoked token on an optional-auth route — treat exactly like no token at all
        // rather than 401ing, matching this decorator's whole point (never reject, just fall
        // back to anonymous).
        request.user = undefined as unknown as FastifyJWT["user"];
      }
    }
  );
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    optionalAuthenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
  interface FastifyRequest {
    jwt: JWT;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    // Shape of the payload passed to sign({ sub: userId, tokenVersion }) in
    // AuthService.issueTokenPair — this is what request.user is typed
    // as after request.jwtVerify() runs in server.authenticate.
    user: {
      sub: string;
      tokenVersion: number;
    };
  }
}