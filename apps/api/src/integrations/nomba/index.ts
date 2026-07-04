/**
 * Singleton Nomba client, initialized from env.ts.
 * Import `nomba` anywhere you need it - Node's module cache ensures this
 * file (and therefore the client, and its in-memory token cache) only
 * runs once per process.
 */


import { NombaClient } from "@/integrations/nomba/nomba.client";
import env from "@/config/env";
import { RedisWebhookIdStore } from "@/integrations/nomba/webhooks";
import redis from "@/config/redis";

export const nomba = new NombaClient({
  clientId: env.NOMBA_CLIENT_ID,
  clientSecret: env.NOMBA_CLIENT_SECRET,
  accountId: env.NOMBA_ACCOUNT_ID,
  subAccountId: env.NOMBA_SUBACCOUNT_ID,
  webhookSecret: env.NOMBA_WEBHOOK_SECRET,
  environment: env.NOMBA_ENVIRONMENT,
  webhookIdStore: new RedisWebhookIdStore(redis),
});