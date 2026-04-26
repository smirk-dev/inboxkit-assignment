import { pool } from '../lib/pg';
import type { TileSnapshot } from '@tilewar/types';

export async function getAllTiles(): Promise<TileSnapshot[]> {
  const { rows } = await pool.query<TileSnapshot>(
    `SELECT x, y, owner_id, owner_username, owner_color,
            claimed_at::text AS claimed_at
     FROM tiles
     ORDER BY y, x`
  );
  return rows;
}

export interface ClaimResult {
  success: boolean;
  tile?: {
    x: number;
    y: number;
    owner_id: string;
    owner_username: string;
    owner_color: string;
    claimed_at: string;
  };
}

export async function atomicClaimTile(
  userId: string,
  username: string,
  color: string,
  x: number,
  y: number
): Promise<ClaimResult> {
  const { rows } = await pool.query(
    `UPDATE tiles
     SET owner_id       = $1,
         owner_username = $2,
         owner_color    = $3,
         claimed_at     = NOW(),
         claim_count    = claim_count + 1
     WHERE x = $4 AND y = $5
       AND (owner_id IS NULL OR owner_id != $1)
     RETURNING x, y, owner_id, owner_username, owner_color,
               claimed_at::text AS claimed_at`,
    [userId, username, color, x, y]
  );
  if (rows.length === 0) return { success: false };
  return { success: true, tile: rows[0] };
}

export async function logClaim(
  userId: string,
  username: string,
  color: string,
  x: number,
  y: number,
  previousOwnerId: string | null
): Promise<void> {
  pool
    .query(
      `INSERT INTO claims_log (user_id, username, user_color, x, y, previous_owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, username, color, x, y, previousOwnerId]
    )
    .catch((err) => console.error('claims_log insert failed', err));
}

export async function clearUserTiles(userId: string): Promise<Array<{ x: number; y: number }>> {
  const { rows } = await pool.query<{ x: number; y: number }>(
    `UPDATE tiles
     SET owner_id       = NULL,
         owner_username = NULL,
         owner_color    = NULL,
         claimed_at     = NULL
     WHERE owner_id = $1
     RETURNING x, y`,
    [userId]
  );
  return rows;
}

export async function upsertUser(
  id: string,
  username: string,
  color: string
): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, username, color)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE
     SET last_seen_at = NOW()`,
    [id, username, color]
  );
}
