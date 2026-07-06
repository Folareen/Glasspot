import { Redis } from "ioredis";
import env from "@/config/env";

/** Each Worker/QueueEvents needs its own connection (BullMQ workers issue blocking commands, so a shared connection would let one blocking call stall another consumer) — use this instead of the shared default export below. */
export function createRedisConnection() {
    return new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null, // disable ioredis's built-in retry logic; we handle it ourselves
    });
}

/** Shared connection for non-blocking usage (Queue producers, cache reads, etc). Never pass this to a Worker or QueueEvents — see createRedisConnection(). */
export default createRedisConnection();