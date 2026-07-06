/**
 * Tracks recent transfers per recipient (destinationAccount+destinationBank)
 * so the transfers worker can hold a job back before it hits Nomba's
 * documented per-recipient cap on POST /v2/transfers/bank — confirmed via
 * the Nomba dashboard's own rate-limit notice: 5 transfers to the SAME
 * recipient per minute. This is separate from and narrower than
 * env.ts's NOMBA_TRANSFER_RATE_LIMIT_MAX (a global cap across every
 * recipient, applied via BullMQ's Worker limiter) — a low-traffic app
 * easily stays under the global cap while still tripping this one, e.g. a
 * recurring payout config firing repeatedly to the same fixed destination,
 * or several pots paying out to the same bank account within the same
 * minute.
 */
export interface TransferThrottle {
  /**
   * Atomically claims one of this recipient's transfer slots for the
   * current window and reports whether the claim succeeded (true = go
   * ahead and call Nomba now; false = already at the cap, don't call
   * Nomba, and this reservation was NOT counted). A single atomic
   * operation rather than a separate "check" + "record" pair — the
   * transfersWorker runs with concurrency:5, so two jobs to the SAME
   * recipient could otherwise both pass a read-only check before either
   * recorded its own transfer, over-admitting past the cap.
   */
  reserve(destinationAccount: string, destinationBank: string): Promise<boolean>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Redis-backed sliding-window counter, one sorted set per recipient
 * (score = timestamp, member = a unique id per transfer so retried calls
 * in the same millisecond don't collide). Works with any client exposing
 * this shape (ioredis, node-redis v4, etc), same minimal-interface pattern
 * as RedisBankStore/RedisWebhookIdStore in this same integrations/nomba
 * folder.
 */
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

  /**
   * Evicts entries older than the window, checks the remaining count
   * against `limit`, and — only if still under it — adds this reservation,
   * all inside one EVAL so no other caller's reserve() can interleave
   * between the check and the add (the race a separate isAllowed()+
   * record() pair would have). Returns 1 (claimed) or 0 (at cap, nothing
   * added) as ioredis's eval() return type, cast to boolean here.
   */
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
