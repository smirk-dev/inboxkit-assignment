-- ============================================================================
-- Tilewar database schema
-- PostgreSQL 14+
--
-- Design notes:
--   * Tiles are pre-populated so every claim is an UPDATE (single atomic
--     statement), never an UPSERT. Cleaner SQL, simpler reasoning about
--     conflicts.
--   * owner_username and owner_color are denormalized onto `tiles` to avoid a
--     JOIN on every broadcast — the read path runs on every claim and needs
--     to be cheap.
--   * claims_log is append-only and powers the activity feed, leaderboard,
--     and post-mortem debugging. It does not block the hot path.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users: anonymous identities, scoped to a socket session
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(32) UNIQUE NOT NULL,
  color         CHAR(7) NOT NULL,                 -- e.g. '#7F77DD'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at DESC);

-- ----------------------------------------------------------------------------
-- tiles: the grid state. 30x15 = 450 rows.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tiles (
  x              SMALLINT NOT NULL,
  y              SMALLINT NOT NULL,
  owner_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_username VARCHAR(32),
  owner_color    CHAR(7),
  claimed_at     TIMESTAMPTZ,
  claim_count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (x, y),
  CHECK (x >= 0 AND x < 30),
  CHECK (y >= 0 AND y < 15)
);

CREATE INDEX IF NOT EXISTS idx_tiles_owner       ON tiles (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiles_claimed_at  ON tiles (claimed_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- claims_log: append-only audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims_log (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username           VARCHAR(32) NOT NULL,        -- denormalized snapshot
  user_color         CHAR(7) NOT NULL,
  x                  SMALLINT NOT NULL,
  y                  SMALLINT NOT NULL,
  previous_owner_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_log_recent ON claims_log (claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_claims_log_user   ON claims_log (user_id, claimed_at DESC);

-- ============================================================================
-- Seed the empty grid (idempotent).
-- ============================================================================
INSERT INTO tiles (x, y)
SELECT gx, gy
FROM generate_series(0, 29) AS gx,
     generate_series(0, 14) AS gy
ON CONFLICT (x, y) DO NOTHING;

-- ============================================================================
-- The atomic claim query — the heart of conflict resolution.
--
-- Two concurrent transactions cannot both succeed: Postgres serializes
-- row-level updates at the storage layer. The WHERE clause prevents a
-- pointless self-claim (already yours).
--
-- If RETURNING returns 0 rows: no-op, server emits `claim_rejected` to
-- the requesting client only.
-- If RETURNING returns 1 row: success, server publishes diff to Redis
-- and Socket.IO broadcasts `tile_claimed` to all clients.
--
--   UPDATE tiles
--   SET    owner_id       = $1,
--          owner_username = $2,
--          owner_color    = $3,
--          claimed_at     = NOW(),
--          claim_count    = claim_count + 1
--   WHERE  x = $4 AND y = $5
--     AND  (owner_id IS NULL OR owner_id != $1)
--   RETURNING x, y, owner_id, owner_username, owner_color, claimed_at;
--
-- Combine in the application layer with a Redis cooldown gate before
-- this query runs:
--
--   SET cooldown:user:<id> 1 NX EX 5
--
-- Returns nil if the user is on cooldown. This prevents the user from
-- spamming the database with rejected claims.
-- ============================================================================
