import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nomba } from "@/integrations/nomba";
import { NombaWebhooksService } from "@/integrations/nomba/nomba-webhooks.service";
import { WebhookEvent, WebhookTransactionData } from "@/integrations/nomba/nomba.types";

/**
 * Registers POST /webhooks/nomba. Overrides the default JSON body parser
 * for this route's encapsulation context only — Nomba's signature is
 * computed over specific PARSED payload fields, not the raw body (see
 * NombaClient.handleWebhook's doc comment), but parsing here as a buffer
 * and letting handleWebhook do the JSON.parse itself still avoids any
 * risk of Fastify's own body handling subtly altering field values (key
 * ordering, whitespace) before verification. Every other route in the app
 * keeps Fastify's normal JSON parsing; this override does not leak
 * outside this plugin.
 */
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
        request.log.warn({ err }, "Nomba webhook rejected");
        return reply.code(401).send({ message: (err as Error).message });
      }
    }
  );
}

export default nombaWebhooksRoutes;
