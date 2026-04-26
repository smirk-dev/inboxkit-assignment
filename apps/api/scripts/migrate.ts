import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });

  console.log('Applying grid resize migration (50x50 → 20x10)...');
  await pool.query(`DELETE FROM tiles WHERE x >= 30 OR y >= 15`);
  await pool.query(`ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_x_check`);
  await pool.query(`ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_y_check`);
  await pool.query(`ALTER TABLE tiles ADD CONSTRAINT tiles_x_check CHECK (x >= 0 AND x < 30)`);
  await pool.query(`ALTER TABLE tiles ADD CONSTRAINT tiles_y_check CHECK (y >= 0 AND y < 15)`);

  const schemaPath = path.resolve(__dirname, '../../../schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Running schema migration...');
  await pool.query(sql);
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
