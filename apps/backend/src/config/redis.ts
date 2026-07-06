import { Redis } from "ioredis";
import env from "@/config/env";

/** BullMQ requirement: Workers issue blocking commands, so each Worker/QueueEvents needs its own connection rather than sharing one — a shared connection lets one blocking call stall another consumer. Use this for every Worker/QueueEvents instance instead of the shared default export below. */
export function createRedisConnection() {
    return new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null, // disable ioredis's built-in retry logic; we handle it ourselves
    });
}

/** Shared connection for non-blocking usage (Queue producers, cache reads, etc). Never pass this to a Worker or QueueEvents — see createRedisConnection(). */
export default createRedisConnection();