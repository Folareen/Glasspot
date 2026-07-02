import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { nomba } from "@/integrations/nomba";
import { NombaWebhooksService } from "@/integrations/nomba/nomba-webhooks.service";
import { WebhookEvent } from "@/integrations/nomba/nomba.types";

/**
 * Registers POST /webhooks/nomba. Overrides the default JSON body parser
 * for this route's encapsulation context only, preserving the exact raw
 * bytes Nomba signed — re-serialized JSON would not match the HMAC
 * signature (see NombaClient.handleWebhook's doc comment). Every other
 * route in the app keeps Fastify's normal JSON parsing; this override does
 * not leak outside this plugin.
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

      try {
        await nomba.handleWebhook(rawBody, signature, async (event: WebhookEvent) => {
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
