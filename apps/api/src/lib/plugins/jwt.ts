import fp from "fastify-plugin";
import fjwt, { FastifyJWT, JWT } from "@fastify/jwt";
import { FastifyReply, FastifyRequest } from "fastify";
import env from "../../config/env.js";

/**
 * Registers @fastify/jwt and wires up the two things the rest of this
 * codebase relies on:
 *
 *  - `request.jwt` — a plain reference to the same signer/verifier
 *    instance living on `server.jwt`, so `auth.controller.ts` can do
 *    `request.jwt.sign(payload)` without touching `reply` at all (the
 *    default @fastify/jwt API signs via `reply.jwtSign`, which doesn't
 *    fit a service that just wants a signing function passed in).
 *  - `server.authenticate` — a preHandler that verifies the incoming
 *    Authorization header and populates `request.user` from the token
 *    payload.
 */
export default fp(async (server) => {
  server.register(fjwt, {
    secret: env.JWT_SECRET as string,
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
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
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