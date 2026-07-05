import fp from "fastify-plugin";
import fjwt, { FastifyJWT, JWT } from "@fastify/jwt";
import { FastifyReply, FastifyRequest } from "fastify";
import env from "@/config/env";

/**
 * Registers @fastify/jwt and wires up the things the rest of this
 * codebase relies on:
 *
 *  - `request.jwt` — a plain reference to the same signer/verifier
 *    instance living on `server.jwt`, so `auth.controller.ts` can do
 *    `request.jwt.sign(payload)` without touching `reply` at all (the
 *    default @fastify/jwt API signs via `reply.jwtSign`, which doesn't
 *    fit a service that just wants a signing function passed in).
 *  - `server.authenticate` — a preHandler that verifies the incoming
 *    Authorization header and populates `request.user` from the token
 *    payload. Rejects with 401 if missing/invalid.
 *  - `server.optionalAuthenticate` — same verification, but does not
 *    reject when the header is missing or invalid; `request.user` is
 *    simply left unset. For routes that behave differently for a logged
 *    in caller (e.g. private-pot visibility) but must also work
 *    anonymously (e.g. browsing public pots).
 */
export default fp(async (server) => {
  server.register(fjwt, {
    secret: env.JWT_SECRET as string,
    sign: {
      // Access tokens are short-lived by design — the refresh token is
      // what carries session longevity (see lib/tokens.ts).
      expiresIn: "15m",
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
    }
  );

  server.decorate(
    "optionalAuthenticate",
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        // No/invalid token — proceed anonymously, request.user stays unset.
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
    // Shape of the payload passed to sign({ sub: userId }) in
    // AuthService.issueTokenPair — this is what request.user is typed
    // as after request.jwtVerify() runs in server.authenticate.
    user: {
      sub: string;
    };
  }
}