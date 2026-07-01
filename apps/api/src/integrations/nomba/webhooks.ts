/**
 * Tracks which webhook requestIds have already been processed, so retried
 * deliveries aren't applied twice. The default in-memory store only protects
 * a single process and forgets everything on restart - pass a Redis/DB-backed
 * implementation via `webhookIdStore` in production (see example at the
 * bottom of this file).
 */
export interface WebhookIdStore {
  has(requestId: string): Promise<boolean>;
  add(requestId: string): Promise<void>;
}
 
export class InMemoryWebhookIdStore implements WebhookIdStore {
  private seen = new Set<string>();
  async has(requestId: string) {
    return this.seen.has(requestId);
  }
  async add(requestId: string) {
    this.seen.add(requestId);
  }
}


/**
 * Redis-backed store for production/multi-instance deployments. Works with
 * any client exposing this shape (ioredis, node-redis v4, etc) - no hard
 * dependency on a specific redis package. Usage:
 *
 *   import Redis from "ioredis";
 *   const redis = new Redis(process.env.REDIS_URL);
 *   const nomba = new NombaClient({ ..., webhookIdStore: new RedisWebhookIdStore(redis) });
 *
 * Keys expire after 30 days by default - long enough to cover any retry
 * window, short enough not to grow Redis unbounded.
 */
export class RedisWebhookIdStore implements WebhookIdStore {
  constructor(
    private redis: {
      exists: (key: string) => Promise<number>;
      set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<string | null>;
    },
    private ttlSeconds = 60 * 60 * 24 * 30,
    private keyPrefix = "nomba:webhook:"
  ) {}
 
  async has(requestId: string): Promise<boolean> {
    return (await this.redis.exists(this.keyPrefix + requestId)) === 1;
  }
 
  async add(requestId: string): Promise<void> {
    await this.redis.set(this.keyPrefix + requestId, "1", "EX", this.ttlSeconds);
  }
}