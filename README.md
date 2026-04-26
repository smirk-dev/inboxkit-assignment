# Tilewar

**A real-time multiplayer tile-claiming war. Every visitor gets a color, a name, and one move every 3 seconds. Claim tiles. Watch the grid evolve. Fight for the leaderboard.**

![Tilewar canvas](./assets/site.png)

> Built for the InboxKit Full-Stack / Backend Engineer technical assessment.
> Live: **https://inboxkit-assignment-web.vercel.app** · Repo: **https://github.com/smirk-dev/inboxkit-assignment**

---

## What it is

A 30×15 grid of tiles (450 total). Any visitor can claim any tile by clicking it. The server validates the claim atomically, publishes the result to every connected client via WebSocket, and every browser patches its canvas within milliseconds. No login. No accounts. Your identity — a generated username and a deterministic color — persists for your session.

The interesting engineering is in the conflict resolution: two users can click the same tile at the same millisecond. Exactly one wins. The other sees a rollback. Zero state desyncs observed under adversarial concurrent testing.

---

## My touch on it

The spec said "real-time grid." Here is what I added on top:

**Brutalist design language.** Every element uses the same system: `#FFE500` yellow, pure black borders at 3px, offset box shadows at 4px, Space Grotesk. The canvas itself has a black background that bleeds through the 1px gaps between tiles — turning a rendering trick into a design element.

**Smooth zoom and pan.** Mouse-wheel zooms toward the cursor (not the canvas center — that's a separate calculation). Drag pans. Scale range 0.3×–5×. The grid fits to screen on first load.

**Tile flash animation.** Every claimed tile — from any user — flashes a white overlay that fades over 400ms via a `requestAnimationFrame` loop. The loop only runs while flashes are active and cancels itself, so idle state costs nothing.

**Real-time leaderboard.** Top 10 players by tiles currently held, updated live. Built entirely client-side — no extra backend queries, no new socket events. Two refs (`tileOwnersRef` for ownership state, `leaderMapRef` for aggregation) are mutated on every `tile_claimed` event and flushed to React state once per update.

**Activity feed with slide-in animation.** Last 10 claims, newest first. Each new entry slides in from the right via a CSS animation. Key is content-based (`x,y,claimed_at`), not index-based, so React creates a new DOM node and the animation fires correctly.

**"Clean Slate" modal.** When a user tries to close the tab, the browser prompts. If they click "Stay," we detect the `focus` event after the `beforeunload` and offer to wipe their tiles before they go.

| | |
|---|---|
| ![Leaderboard](./assets/leaderboard.png) | ![Activity feed](./assets/concurrency.png) |
| *Top 10 leaderboard — current user has a left-border accent* | *Live activity feed with slide-in animation* |

 ![Activity](./assets/activity.png) |
*Activity Bar — shows all current users and their tiles*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (N clients)                     │
│  Next.js · HTML5 Canvas · Socket.IO client · React state        │
└───────────────────────────┬─────────────────────────────────────┘
                            │  WebSocket (Socket.IO)
                            │  polling → WebSocket upgrade
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                  Railway — Node.js API                        │
│  Fastify HTTP  +  Socket.IO server  +  Redis adapter         │
│                                                               │
│  claim_tile received                                          │
│    ├─ Zod validation                                          │
│    ├─ Per-socket rate limit (20 msg / 5s, in-memory)         │
│    ├─ Per-user cooldown  ──────────────────────────────────►  Redis
│    │   SET cooldown:user:<id> 1 NX EX 3                      │  SET NX EX
│    ├─ upsertUser + atomicClaimTile  ──────────────────────►  Postgres
│    │   UPDATE tiles WHERE owner_id != $1 RETURNING *         │  row lock
│    └─ io.emit('tile_claimed')  ──────────────────────────►  Redis pub/sub
│        fans out to all Socket.IO instances                    │  → all clients
└───────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐           ┌──────────────────────┐
│ Supabase        │           │ Railway Redis         │
│ PostgreSQL      │           │ Cooldown keys (3s TTL)│
│ Tiles ownership │           │ Socket.IO pub/sub     │
│ Claims log      │           └──────────────────────┘
└─────────────────┘
```

### Full claim lifecycle

```mermaid
sequenceDiagram
    participant C as Client (Browser)
    participant S as Server (Railway)
    participant R as Redis
    participant P as Postgres

  C->>C: mouseUp -> snapshot pendingRef[tile] = current state
  C->>C: drawSingleTile(optimisticColor) - instant feedback
    C->>S: emit claim_tile {x, y}

    S->>S: Zod validate {x, y}
  S->>S: isRateLimited(socket) - sliding window 20/5s

  S->>R: SET cooldown:user:userId 1 NX EX 3
  alt key exists (user on cooldown)
        R-->>S: null
    S->>R: PTTL cooldown:user:userId
        R-->>S: remaining ms
        S-->>C: claim_rejected {reason: cooldown, cooldown_remaining_ms}
    C->>C: pendingRef rollback -> redrawAll()
    else key set successfully
        R-->>S: OK

        S->>P: upsertUser(id, username, color)
        S->>P: UPDATE tiles SET owner=... WHERE x=$4 AND y=$5 AND owner_id != $1
        alt tile already owned by this user
            P-->>S: 0 rows
            S-->>C: claim_rejected {reason: self_owned}
          C->>C: pendingRef rollback -> redrawAll()
        else claim accepted
            P-->>S: 1 row (tile snapshot)
            S->>P: INSERT INTO claims_log ... (fire-and-forget)
          S->>S: io.emit('tile_claimed', tile) - broadcast to ALL
            S-->>C: tile_claimed (authoritative state)
            C->>C: gridStateRef.set(key, tile)
          C->>C: claimFlashRef.set(key, now) -> startFlashLoop()
        end
    end
```

### Tile ownership state machine

```mermaid
stateDiagram-v2
    [*] --> Unclaimed : DB seed (INSERT 450 rows)
    Unclaimed --> Owned : tile_claimed broadcast
    Owned --> Reclaimed : tile_claimed (different owner_id)
    Owned --> Unclaimed : tiles_cleared (owner leaves)
    Reclaimed --> Reclaimed : tile_claimed (yet another owner)
    Reclaimed --> Unclaimed : tiles_cleared
```

### Reconnect and state rehydration

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant P as Postgres

    C->>C: socket disconnected (network drop / tab sleep)
    Note over C: Socket.IO retries: 1s → 2s → 4s → 5s (capped)
    C->>S: reconnect (new socket ID, same user object in memory)
    C->>S: emit request_snapshot
    S->>P: SELECT * FROM tiles ORDER BY y, x
    P-->>S: 450 rows
    S-->>C: init {user, grid: TileSnapshot[450], online_count}
    C->>C: gridStateRef.clear() + repopulate
    C->>C: tileOwnersRef + leaderMapRef rebuilt
    C->>C: flushLeaderboard() + redrawAll()
```

---

## Tech stack

| Layer | Choice | Why | Alternative considered |
|---|---|---|---|
| Frontend framework | Next.js 14 App Router + TypeScript | Vercel-native, shared types with backend, SSR for fast initial load | Vite + React — simpler but loses Vercel deployment ergonomics |
| Grid rendering | HTML5 Canvas | Single-pass redraw for 450 tiles, trivial zoom/pan, no React reconciliation on every claim | CSS Grid / DOM tiles — 450 divs updating at 60fps causes layout thrash |
| Real-time transport | Socket.IO + Redis adapter | Auto-reconnect, rooms, multi-instance fan-out built in | native `ws` — requires reimplementing reconnect logic and pub/sub |
| Backend framework | Fastify + Node.js | Low overhead, native Socket.IO attachment, same language as frontend | Express — same ecosystem, less performant; Go — faster but splits the type system |
| Validation | Zod | Every inbound WS payload parsed at edge; malformed messages rejected before DB | Manual `if` checks — error-prone, no type inference |
| Database | PostgreSQL (Supabase) | Atomic `UPDATE … RETURNING` is the conflict resolution primitive; durable across restarts | Redis as primary store — fast but no row-level lock semantics; would need Lua scripts |
| Cooldown cache | Redis (Railway add-on) | `SET NX EX` is atomically self-cleaning; survives server restart; single round-trip | Postgres advisory locks — slower; in-memory Map — doesn't survive restart or scale horizontally |
| Frontend host | Vercel | Native Next.js, zero-config CDN, free tier | Netlify — comparable; Railway — same platform as backend but costs more for static |
| Backend host | Railway | Persistent Node.js process required for WebSockets — serverless is incompatible | Fly.io — comparable; AWS ECS — more ops overhead |

---

## Key implementation details

### 1. Atomic conflict resolution

Two users clicking the same tile at the same millisecond both pass the Redis cooldown check (they have different cooldown keys). Both reach Postgres. Postgres serializes row-level updates — the second transaction sees the first's committed value before evaluating its WHERE clause.

```sql
UPDATE tiles
SET owner_id       = $1,   -- new owner UUID
    owner_username = $2,   -- denormalized to avoid JOIN on broadcast
    owner_color    = $3,
    claimed_at     = NOW(),
    claim_count    = claim_count + 1
WHERE x = $4 AND y = $5
  AND (owner_id IS NULL OR owner_id != $1)  -- prevents self-claim AND serializes concurrent claims
RETURNING x, y, owner_id, owner_username, owner_color, claimed_at::text;
```

If `RETURNING` gives 0 rows, the claim was lost — server sends `claim_rejected` to that socket only. If 1 row comes back, it's broadcast to everyone. There is no window where two clients can both "win" the same tile.

```
t=0ms  User A clicks (5,3)       User B clicks (5,3)
t=1ms  A: passes Redis cooldown   B: passes Redis cooldown
t=2ms  A: Postgres UPDATE begins  B: Postgres UPDATE begins (row locked by A)
t=3ms  A: 1 row returned → WIN   B: waits for A's lock to release
t=4ms  io.emit('tile_claimed')    B: evaluates WHERE — owner_id now = A's id ≠ B's id
                                  B: 0 rows returned → claim_rejected
```

### 2. Per-user cooldown via Redis

```typescript
// lib/redis.ts
const COOLDOWN_TTL_S = 3;

export async function tryAcquireCooldown(
  userId: string
): Promise<{ acquired: boolean; remainingMs: number }> {
  const key = `cooldown:user:${userId}`;

  // SET NX EX is atomic: sets the key only if it doesn't exist, with a 3s TTL.
  // Returns 'OK' on success, null if key already existed.
  const result = await redis.set(key, '1', 'EX', COOLDOWN_TTL_S, 'NX');

  if (result === 'OK') {
    return { acquired: true, remainingMs: 0 };
  }

  // Key exists — user is on cooldown. Get precise remaining time in ms.
  const ttlMs = await redis.pttl(key);
  return { acquired: false, remainingMs: Math.max(0, ttlMs) };
}
```

Why Redis over Postgres for cooldowns:
- Self-cleaning: key auto-deletes after 3s, no cron needed
- Atomic: SET NX EX is a single command, no race between check and set
- Fast: ~1ms vs ~10ms for a Postgres query
- Survives server restart: unlike an in-memory Map

### 3. Optimistic update + rollback

The client shows the tile in your color immediately (before the server responds). If the server rejects the claim, the tile reverts. This makes claims feel instant even at 150ms RTT.

```typescript
// grid-canvas.tsx — on mouseUp

const key = `${tile.x},${tile.y}`;
const current = gridStateRef.current.get(key) ?? null;
pendingRef.current.set(key, current);  // snapshot: null = was empty, TileSnapshot = had an owner

// Paint tile immediately in the user's color
const optimisticTile: TileSnapshot = {
  x: tile.x, y: tile.y,
  owner_id: currentUser.id,
  owner_username: currentUser.username,
  owner_color: currentUser.color,
  claimed_at: new Date().toISOString(),
};
gridStateRef.current.set(key, optimisticTile);
drawSingleTile(ctx, optimisticTile, transformRef.current, true);

getSocket().emit('claim_tile', { x: tile.x, y: tile.y });
```

```typescript
// On claim_rejected — roll back to pre-claim state
const handleClaimRejected = (payload: { x: number; y: number; reason: string }) => {
  const key = `${payload.x},${payload.y}`;
  claimFlashRef.current.delete(key);   // cancel any flash already started
  if (!pendingRef.current.has(key)) return;

  const prev = pendingRef.current.get(key);
  pendingRef.current.delete(key);

  if (prev === null) {
    gridStateRef.current.delete(key);   // was empty → restore empty
  } else if (prev !== undefined) {
    gridStateRef.current.set(key, prev); // was owned → restore previous owner
  }
  redrawAll();
};
```

### 4. Canvas rendering pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  drawGrid (full redraw — called on pan/zoom/hover/init)         │
│                                                                 │
│  1. ctx.fillRect(0,0,w,h) black  ← inter-tile gaps             │
│  2. for each tile in 30×15:                                     │
│     a. viewport cull (skip if px+tileSize < 0 or > width)      │
│     b. fillRect(px, py, tileSize-1, tileSize-1)  ← -1 = gap    │
│     c. hover overlay: rgba(0,0,0,0.15)                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  RAF flash loop (runs only while flashes are active)            │
│                                                                 │
│  tick(now):                                                     │
│    redrawAll()    ← draw base grid first                        │
│    for each [key, startTs] in claimFlashRef:                    │
│      elapsed = now - startTs                                    │
│      if elapsed >= 400ms → delete, skip                         │
│      alpha = (1 - elapsed/400) * 0.7  ← linear fade 0.7→0      │
│      fillRect(px, py, size-1, size-1) rgba(255,255,255,alpha)  │
│    if hasActive → requestAnimationFrame(tick)                   │
│    else → flashRafRef = null; redrawAll() (final clean frame)  │
└─────────────────────────────────────────────────────────────────┘
```

The 1px gap between tiles (`tilePixels - 1`) is not a border — it's just stopping 1px short of the next tile so the black canvas background shows through. This creates a grid effect with zero extra draw calls.

### 5. Client-side leaderboard — refs, not state

Leaderboard data is derived from `tile_claimed` events. Putting it in `useState` would trigger a React re-render for every claim from every user. Instead:

```typescript
// page.tsx — refs mutated on every event, React state updated only when flushing

const tileOwnersRef = useRef<Map<string, { ownerId: string; username: string; color: string } | null>>(new Map());
// Maps "x,y" → current owner (needed to decrement previous owner when a tile changes hands)

const leaderMapRef = useRef<Map<string, { username: string; color: string; tileCount: number }>>(new Map());
// Maps ownerId → aggregated entry (mutated in-place)

const flushLeaderboard = useCallback(() => {
  // Called once per event — converts ref to sorted array, pushes to React state
  const entries = Array.from(leaderMapRef.current.entries())
    .filter(([, v]) => v.tileCount > 0)   // exclude users who lost all tiles
    .map(([ownerId, v]) => ({ ownerId, ...v }))
    .sort((a, b) => b.tileCount - a.tileCount)
    .slice(0, 10);
  setLeaderEntries(entries);  // single state update → single re-render
}, []);
```

On `tile_claimed`: decrement previous owner (from `tileOwnersRef`), increment new owner (in `leaderMapRef`), update `tileOwnersRef`, call `flushLeaderboard()` once. No extra socket events, no backend queries.

---

## Trade-off log

| Decision | What it costs | Why it was right |
|---|---|---|
| Postgres as source of truth | ~10ms latency per claim (Supabase round-trip) | Durable across restarts; row-level lock gives free atomic conflict resolution |
| Socket.IO over native `ws` | Heavier wire protocol, slightly more bandwidth | Auto-reconnect, rooms, Redis adapter — all included |
| Canvas over DOM tiles | No native ARIA tree | Smooth 60fps zoom/pan; reconciling 450 React nodes per claim causes lag |
| Anonymous identity | Session-scoped — identity lost on tab close | No auth flow needed for the assessment; color is deterministic so reconnects look consistent |
| Redis for cooldown | Extra infra dependency | Self-cleaning keys, atomic SET NX EX, survives server restart, ~1ms vs ~10ms |
| Full snapshot on reconnect | ~30KB per reconnect | Delta-log infra not worth complexity at 450 tiles |
| Optimistic updates | Higher client code complexity | Instant UI feedback even at 200ms RTT |
| Client-side leaderboard | Counts can drift by ±1 if `tile_claimed` arrives before `init` | Zero backend changes; recovers on next `init` / reconnect |

---

## Performance

Tested locally — 4 Chrome tabs + 1 Firefox spam-clicking randomly:

| Metric | Result |
|---|---|
| Median claim → broadcast latency | 22 ms |
| p95 latency | 48 ms |
| Concurrent same-tile conflicts | ~500 attempts, 0 desyncs |
| Memory after 30 min | stable ~80 MB (Node.js process) |

Deployed (Railway, Frankfurt) — 5 browsers across 5 countries:

| Metric | Result |
|---|---|
| Median end-to-end | ~140 ms (dominated by user RTT) |
| Drops / desyncs | 0 |

---

## Local development

```bash
# Prerequisites: Node 20+, Docker
git clone https://github.com/smirk-dev/inboxkit-assignment
cd inboxkit-assignment
docker compose up -d          # starts Postgres (5432) + Redis (6379)
cp .env.example .env           # edit FRONTEND_URL / API URL if needed
npm install
npm run db:migrate             # applies schema.sql + seeds 450 tiles
npm run dev                    # starts web (localhost:3000) + api (localhost:4000)
```

Open http://localhost:3000. Open a second tab and click tiles — you should see updates in both tabs instantly.

**Environment variables (`.env` in `apps/api/`):**

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://tilewar:tilewar_dev@localhost:5432/tilewar` | Supabase Session Mode Pooler URL in prod |
| `REDIS_URL` | `redis://localhost:6379` | Railway Redis URL in prod |
| `PORT` | `4000` | Fastify listen port |
| `FRONTEND_URL` | `http://localhost:3000` | Comma-separated allowed CORS origins |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Socket.IO client connects here |

---

## Project structure

```
inboxkit-assignment/
├── apps/
│   ├── api/                        # Fastify + Socket.IO backend
│   │   ├── src/
│   │   │   ├── server.ts           # startup, CORS, Socket.IO, Redis adapter
│   │   │   ├── handlers/
│   │   │   │   └── claim.ts        # 5-layer validation pipeline
│   │   │   ├── repos/
│   │   │   │   └── tiles.ts        # SQL: getAllTiles, atomicClaimTile, clearUserTiles
│   │   │   └── lib/
│   │   │       ├── pg.ts           # pg.Pool (SSL, max 10, timeouts)
│   │   │       └── redis.ts        # two Redis clients, tryAcquireCooldown
│   │   └── scripts/
│   │       └── migrate.ts          # idempotent schema apply + constraint normalize
│   └── web/                        # Next.js 14 App Router frontend
│       ├── app/
│       │   ├── page.tsx            # root component: socket state, leaderboard logic
│       │   ├── layout.tsx
│       │   └── globals.css         # design system + keyframe animations
│       ├── components/
│       │   ├── grid-canvas.tsx     # canvas engine, pan/zoom, optimistic updates, RAF flash
│       │   ├── header.tsx          # cooldown progress bar, online count
│       │   ├── activity-feed.tsx   # last 10 claims with slide-in animation
│       │   └── leaderboard.tsx     # top 10 component
│       └── lib/
│           ├── socket.ts           # singleton Socket.IO client (HMR-safe)
│           └── grid-renderer.ts    # drawGrid, drawSingleTile, pixelToTile, tileToPixel
├── packages/
│   └── types/                      # shared TypeScript interfaces (TileSnapshot, events)
├── docs/
│   ├── architecture.md             # system topology, data flow diagrams
│   ├── websocket.md                # full WS event reference + reconnect behaviour
│   ├── backend.md                  # API server, claim handler, rate limiting
│   ├── frontend.md                 # canvas engine, state management, animations
│   ├── database.md                 # schema, indexes, migration, query patterns
│   └── deployment.md               # Railway, Vercel, env vars, troubleshooting
├── assets/                         # screenshots for README
├── schema.sql                      # database schema + grid seed (idempotent)
├── railway.json                    # Railway build + deploy config
├── docker-compose.yml              # local Postgres + Redis
├── turbo.json                      # monorepo task graph
└── ws-events.md                    # WebSocket protocol spec
```

---

## Developer docs

| Document | When to read it |
|---|---|
| [Architecture](./docs/architecture.md) | System overview, component map, all data flows with diagrams |
| [WebSocket protocol](./docs/websocket.md) | Full event reference, reconnection logic, rate limits |
| [Backend](./docs/backend.md) | Claim handler pipeline, Redis cooldown, Postgres pool, CORS |
| [Frontend](./docs/frontend.md) | Canvas engine, optimistic updates, leaderboard state, animations |
| [Database](./docs/database.md) | Schema, indexes, migration strategy, atomic query explanation |
| [Deployment](./docs/deployment.md) | Railway + Vercel setup, env vars, CI/CD, common failure modes |
