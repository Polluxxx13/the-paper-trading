import fs from 'node:fs';
import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

/** Applique db/schema.sql (idempotent) au démarrage : pas de shell nécessaire sur Render. */
export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(config.schemaPath, 'utf8');
  await pool.query(sql);
}
