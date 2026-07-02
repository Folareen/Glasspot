import { Redis } from "ioredis";
import env from "@/config/env";

export default new Redis(env.REDIS_URL);