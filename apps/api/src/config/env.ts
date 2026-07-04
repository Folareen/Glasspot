import { config } from "dotenv";
import { expand } from "dotenv-expand";

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
  REDIS_URL: z.string(),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string(),
  SMTP_PASSWORD: z.string(),
  MAIL_FROM: z.string().default("Glasspot <no-reply@glasspot.app>"),
});

export type EnvSchema = z.infer<typeof EnvSchema>;

expand(config());

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