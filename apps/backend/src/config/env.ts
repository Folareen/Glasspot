import { config } from "dotenv";
import { expand } from "dotenv-expand";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ZodError, z } from "zod";

const stringBoolean = z.coerce.string().transform((val) => {
  return val === "true";
}).default("false");

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DB_HOST: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  DB_PORT: z.coerce.number(),
  DATABASE_URL: z.string(),
  DB_MIGRATING: stringBoolean,
  DB_SEEDING: stringBoolean,
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  REFRESH_TOKEN_SECRET: z.string(),
  JWT_SECRET: z.string(),
  NOMBA_ENVIRONMENT: z.enum(["production", "sandbox"]).default("sandbox"),
  NOMBA_CLIENT_ID: z.string(),
  NOMBA_CLIENT_SECRET: z.string(),
  NOMBA_ACCOUNT_ID: z.string(),
  NOMBA_SUBACCOUNT_ID: z.string(),
  NOMBA_WEBHOOK_SECRET: z.string(),
  // Global rate limit against Nomba's /transfer endpoint across all transfer worker jobs.
  // Placeholder defaults — replace with Nomba's documented limit (with headroom) before launch.
  NOMBA_TRANSFER_RATE_LIMIT_MAX: z.coerce.number().default(10),
  NOMBA_TRANSFER_RATE_LIMIT_DURATION_MS: z.coerce.number().default(1000),
  REDIS_URL: z.string(),
  BREVO_API_KEY: z.string(),
  MAIL_FROM: z.string().default("Glasspot <no-reply@glasspot.app>"),
  BULL_BOARD_ENABLED: stringBoolean,
  // Comma-separated user ids allowed to force-refresh the cached bank list — a narrow allowlist
  // since there's no general staff/admin role yet ("admin" elsewhere is per-pot, not global).
  BANKS_REFRESH_ALLOWED_USER_IDS: z.string().default(""),
});

export type EnvSchema = z.infer<typeof EnvSchema>;

// Node's --env-file flag (used by this app's dev/start scripts) doesn't
// expand ${VAR} references, so DATABASE_URL's interpolation needs dotenv +
// dotenv-expand loading .env directly, self-located regardless of cwd.
const envFile = process.env.TESTING === "true" ? ".env.test" : ".env";

console.log(`Loading environment variables from ${envFile}...`);

const envPath = path.resolve(fileURLToPath(import.meta.url), "../../../" + envFile);
expand(config({ path: envPath, override: true }));

let env: EnvSchema;

try {
  env = EnvSchema.parse(process.env);
} catch (error) {
  if (error instanceof ZodError) {
    let message = "Missing required values in .env:\n";
    error.issues.forEach((issue) => {
      message += String(issue.path[0]) + "\n";
    });
    const e = new Error(message);
    e.stack = "";
    throw e;
  }
  throw error;
}

export default env;