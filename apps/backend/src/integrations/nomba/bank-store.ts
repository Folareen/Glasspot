import { Bank } from "@/integrations/nomba/nomba.types";

/**
 * Caches Nomba's bank list (rarely changes) across process restarts and
 * multiple instances. Unlike WebhookIdStore's entries, this cache has no
 * TTL by design — it only clears on an explicit refresh() call, since
 * there's no natural expiry for "the list of Nigerian banks."
 */
export interface BankStore {
  get(): Promise<Bank[] | null>;
  set(banks: Bank[]): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Redis-backed bank list cache, one JSON blob under a single key — no TTL,
 * so it survives indefinitely until clear() is called (see routes/banks
 * for the refresh endpoint that does so). Works with any client exposing
 * this shape (ioredis, node-redis v4, etc), same pattern as
 * RedisWebhookIdStore in webhooks.ts.
 */
export class RedisBankStore implements BankStore {
  constructor(
    private redis: {
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<string | null>;
      del: (key: string) => Promise<number>;
    },
    private key = "nomba:banks"
  ) {}

  /** Returns the cached bank list, or null if nothing has been cached yet. */
  async get(): Promise<Bank[] | null> {
    const raw = await this.redis.get(this.key);
    return raw ? (JSON.parse(raw) as Bank[]) : null;
  }

  /** Overwrites the cached bank list with no expiry. */
  async set(banks: Bank[]): Promise<void> {
    await this.redis.set(this.key, JSON.stringify(banks));
  }

  /** Clears the cache so the next get() miss forces a fresh fetch from Nomba. */
  async clear(): Promise<void> {
    await this.redis.del(this.key);
  }
}
