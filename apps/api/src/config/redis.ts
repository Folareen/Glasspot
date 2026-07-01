import { Redis } from "ioredis";
import env from "./env.js";

export default new Redis(env.REDIS_URL);