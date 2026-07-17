import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nomba } from "@/integrations/nomba";
import { NombaWebhooksService } from "@/integrations/nomba/nomba-webhooks.service";
import { WebhookEvent, WebhookTransactionData } from "@/integrations/nomba/nomba.types";
import { WebhookVerificationError } from "@/integrations/nomba/nomba.error";

/** Registers POST /webhooks/nomba, overriding the default JSON body parser for this route only so the raw buffer reaches handleWebhook unaltered before signature verification. */
async function nombaWebhooksRoutes(server: FastifyInstance) {
  server.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  server.post(
    "/nomba",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawBody = request.body as Buffer;
      const signature = request.headers["nomba-signature"] as string | undefined;
      const timestamp = request.headers["nomba-timestamp"] as string | undefined;

      try {
        await nomba.handleWebhook(rawBody, signature, timestamp, async (event: WebhookEvent<WebhookTransactionData>) => {
          await NombaWebhooksService.handle(event, true);
        });
        return reply.code(200).send({ received: true });
      } catch (err) {
        // WebhookVerificationError means the request itself was malformed/unauthenticated (bad
        // signature, missing headers, invalid JSON) — safe to report back with a generic 401,
        // never the raw error message (this route has no auth, so an attacker could otherwise
        // probe it for internal details just by sending malformed requests). Anything else means
        // the request WAS genuinely from Nomba (passed verification) but our own processing of it
        // failed — an internal error, reported as a generic 500 with no message leak, distinct
        // from "your signature was bad" so it doesn't get misread as an auth failure downstream
        // (by Nomba's own retry/alerting, or by anyone reading these logs later).
        if (err instanceof WebhookVerificationError) {
          request.log.warn({ err }, "Nomba webhook rejected: verification failed");
          return reply.code(401).send({ message: "Webhook verification failed" });
        }
        request.log.error({ err }, "Nomba webhook processing failed");
        return reply.code(500).send({ message: "Internal error processing webhook" });
      }
    }
  );
}

export default nombaWebhooksRoutes;
