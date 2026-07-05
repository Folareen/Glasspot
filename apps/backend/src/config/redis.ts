import { Redis } from "ioredis";
import env from "@/config/env";

export default new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // disable ioredis's built-in retry logic; we handle it ourselves
});