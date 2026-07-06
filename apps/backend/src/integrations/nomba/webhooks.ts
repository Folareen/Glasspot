/** Tracks processed webhook requestIds so retried deliveries aren't applied twice; pass a Redis/DB-backed implementation via `webhookIdStore` in production, since the in-memory default forgets everything on restart. */
export interface WebhookIdStore {
  has(requestId: string): Promise<boolean>;
  add(requestId: string): Promise<void>;
}
 
export class InMemoryWebhookIdStore implements WebhookIdStore {
  private seen = new Set<string>();
  /** Returns whether requestId has already been recorded as processed. */
  async has(requestId: string) {
    return this.seen.has(requestId);
  }
  /** Records requestId as processed for the lifetime of this process. */
  async add(requestId: string) {
    this.seen.add(requestId);
  }
}


/** Redis-backed WebhookIdStore for production/multi-instance deployments, working with any client exposing the shape below (ioredis, node-redis v4, etc); keys expire after 30 days by default to cover the retry window without growing Redis unbounded. */
export class RedisWebhookIdStore implements WebhookIdStore {
  /** Builds a store backed by the given Redis-like client, with a configurable key TTL and prefix. */
  constructor(
    private redis: {
      exists: (key: string) => Promise<number>;
      set: (key: string, value: string, mode: "EX", ttlSeconds: number) => Promise<string | null>;
    },
    private ttlSeconds = 60 * 60 * 24 * 30,
    private keyPrefix = "nomba:webhook:"
  ) {}

  /** Returns whether requestId has already been recorded as processed, across all instances sharing this Redis. */
  async has(requestId: string): Promise<boolean> {
    return (await this.redis.exists(this.keyPrefix + requestId)) === 1;
  }

  /** Records requestId as processed, expiring the key after ttlSeconds. */
  async add(requestId: string): Promise<void> {
    await this.redis.set(this.keyPrefix + requestId, "1", "EX", this.ttlSeconds);
  }
}