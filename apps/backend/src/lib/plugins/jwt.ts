import fp from "fastify-plugin";
import fjwt, { FastifyJWT, JWT } from "@fastify/jwt";
import { FastifyReply, FastifyRequest } from "fastify";
import env from "@/config/env";

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