import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL environment variable is not set');

  try {
    const { host, pathname } = new URL(dbUrl);
    console.log(`Connecting to database: ${host}${pathname}`);
  } catch { /* non-parseable URL — still attempt connection */ }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });

  // Step 1: apply base schema first so all tables exist before we touch them.
  // CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING — fully idempotent.
  const schemaPath = path.resolve(__dirname, '../../../schema.sql');
  console.log('Applying base schema...');
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));

  // Step 2: normalise grid constraints (safe on both fresh and previously-migrated DBs).
  console.log('Normalising grid constraints...');
  await pool.query(`DELETE FROM tiles WHERE x >= 30 OR y >= 15`);
  await pool.query(`ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_x_check`);
  await pool.query(`ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_y_check`);
  await pool.query(`ALTER TABLE tiles ADD CONSTRAINT tiles_x_check CHECK (x >= 0 AND x < 30)`);
  await pool.query(`ALTER TABLE tiles ADD CONSTRAINT tiles_y_check CHECK (y >= 0 AND y < 15)`);

  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
