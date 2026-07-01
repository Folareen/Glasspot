import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stringBoolean = z.coerce.string().transform((val) => val === "true").default("false");

const EnvSchema = z.object({
  DATABASE_URL: z.string(),
  DB_MIGRATING: stringBoolean,
});

// This package has no .env of its own — always defer to the monorepo root .env,
// regardless of which workspace's cwd this is invoked from.
const rootEnvPath = path.resolve(fileURLToPath(import.meta.url), "../../../../.env");
expand(config({ path: rootEnvPath }));

export default EnvSchema.parse(process.env);
