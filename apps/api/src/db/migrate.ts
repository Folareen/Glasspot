import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, connection } from './index.js';
import env from '../config/env.js';
import { MIGRATIONS_FOLDER } from '../config/db.js';

if (!env.DB_MIGRATING) {
  throw new Error('You must set DB_MIGRATING to "true" when running migrations');
}

await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

await connection.end();