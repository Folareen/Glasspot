import { defineConfig } from "drizzle-kit";
import env from './src/config/env.js';
import { MIGRATIONS_FOLDER } from './src/config/db.js';

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: MIGRATIONS_FOLDER,
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});