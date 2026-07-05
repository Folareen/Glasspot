import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { expand } from "dotenv-expand";
import path from "node:path";
import { fileURLToPath } from "node:url";

// drizzle-kit runs as a standalone CLI, not through the app's `tsx --env-file`
// scripts, so it needs its own load of .env.
const envPath = path.resolve(fileURLToPath(import.meta.url), "../.env");
expand(config({ path: envPath }));

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
