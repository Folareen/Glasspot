import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from "postgres";
import * as schema from './schema/index.js';
import env from '../config/env.js';

export const connection = postgres(env.DATABASE_URL, {
  max: (env.DB_MIGRATING) ? 1 : undefined,
});

export const db = drizzle(connection, {
  schema,
  logger: true,
});

export type db = typeof db;

export default db;