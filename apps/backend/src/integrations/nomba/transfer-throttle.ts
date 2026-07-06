/** Tracks recent transfers per recipient so the transfers worker can hold a job back before hitting Nomba's per-recipient cap of 5 transfers/minute on POST /v2/transfers/bank — narrower than and separate from env.ts's global NOMBA_TRANSFER_RATE_LIMIT_MAX. */
export interface TransferThrottle {
  // Must claim and record atomically, not check-then-record: transfersWorker runs with concurrency:5, so two jobs to the same recipient could otherwise both pass a read-only check before either recorded its transfer, over-admitting past the cap.
  /** Atomically claims one of this recipient's transfer slots for the current window; returns true if claimed (go ahead and call Nomba), false if already at the cap (nothing was counted). */
  reserve(destinationAccount: string, destinationBank: string): Promise<boolean>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 60;

/** Redis-backed sliding-window counter, one sorted set per recipient (score = timestamp, member = a unique id per transfer so same-millisecond retries don't collide). */
const RESERVE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  local count = redis.call('ZCARD', KEYS[1])
  if count < tonumber(ARGV[2]) then
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return 1
  end
  return 0
`;

export class RedisTransferThrottle implements TransferThrottle {
  constructor(
    // ioredis's own eval(script, numkeys, ...keysAndArgs) shape — not
    // node-redis v4's {keys, arguments} object shape — since ioredis is
    // this codebase's actual client (see config/redis.ts).
    private redis: {
      eval: (script: string, numkeys: number, ...keysAndArgs: string[]) => Promise<unknown>;
    },
    private limit = DEFAULT_LIMIT,
    private windowSeconds = DEFAULT_WINDOW_SECONDS,
    private keyPrefix = "nomba:transfer-throttle:"
  ) {}

  private key(destinationAccount: string, destinationBank: string): string {
    return `${this.keyPrefix}${destinationBank}:${destinationAccount}`;
  }

  /** Evicts entries older than the window, checks the count against `limit`, and adds this reservation only if still under it, all inside one EVAL so no other caller's reserve() can interleave between the check and the add. */
  async reserve(destinationAccount: string, destinationBank: string): Promise<boolean> {
    const key = this.key(destinationAccount, destinationBank);
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    const claimed = await this.redis.eval(
      RESERVE_SCRIPT,
      1,
      key,
      String(windowStart),
      String(this.limit),
      String(now),
      `${now}:${Math.random()}`,
      String(this.windowSeconds)
    );

    return claimed === 1;
  }
}

/** In-memory fallback for tests/local dev without Redis — only correct within a single process, same caveat as InMemoryWebhookIdStore. Single-threaded JS makes this naturally atomic, no script needed. */
export class InMemoryTransferThrottle implements TransferThrottle {
  private recent = new Map<string, number[]>();

  constructor(
    private limit = DEFAULT_LIMIT,
    private windowSeconds = DEFAULT_WINDOW_SECONDS
  ) {}

  private key(destinationAccount: string, destinationBank: string): string {
    return `${destinationBank}:${destinationAccount}`;
  }

  async reserve(destinationAccount: string, destinationBank: string): Promise<boolean> {
    const key = this.key(destinationAccount, destinationBank);
    const windowStart = Date.now() - this.windowSeconds * 1000;
    const timestamps = (this.recent.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= this.limit) {
      this.recent.set(key, timestamps);
      return false;
    }

    timestamps.push(Date.now());
    this.recent.set(key, timestamps);
    return true;
  }
}
