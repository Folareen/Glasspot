import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nomba } from "@/integrations/nomba";
import { NombaWebhooksService } from "@/integrations/nomba/nomba-webhooks.service";
import { WebhookEvent, WebhookTransactionData } from "@/integrations/nomba/nomba.types";

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
        request.log.warn({ err }, "Nomba webhook rejected");
        return reply.code(401).send({ message: (err as Error).message });
      }
    }
  );
}

export default nombaWebhooksRoutes;
