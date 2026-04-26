# Architecture

> **Quick orientation**
> - Read this first if you're new to the project — it maps every moving part and every data flow.
> - The claim lifecycle diagram is the most useful single reference: it shows exactly what happens between a mouse click and every browser updating.
> - For per-component deep dives, see the other docs files linked at the bottom.

---

## System component map

```mermaid
graph TD
    subgraph "Client (Browser)"
        B[Next.js App<br/>Vercel CDN]
        BC[HTML5 Canvas<br/>grid-canvas.tsx]
        BS[Socket.IO client<br/>lib/socket.ts]
        BL[Leaderboard state<br/>page.tsx refs]
    end

    subgraph "API (Railway — persistent Node.js)"
        F[Fastify HTTP server<br/>:4000]
        SIO[Socket.IO server]
        CH[Claim handler<br/>handlers/claim.ts]
        TR[Tiles repo<br/>repos/tiles.ts]
    end

    subgraph "Data stores"
        PG[(PostgreSQL<br/>Supabase)]
        RD[(Redis<br/>Railway add-on)]
    end

    B --> BS
    BS <-->|WebSocket / polling| SIO
    SIO --> F
    SIO --> CH
    CH --> TR
    TR --> PG
    CH -->|SET NX EX 3| RD
    SIO -->|Redis adapter<br/>pub/sub fan-out| RD
    RD -->|broadcast to all<br/>Socket.IO instances| SIO
    BS --> BC
    BS --> BL
```

---

## Data flow: claim lifecycle

This is the most important flow in the system. Read it in full before touching the claim handler or the canvas component.

```mermaid
sequenceDiagram
    participant C as Client A (clicker)
    participant O as Other Clients
    participant S as API Server
    participant R as Redis
    participant P as Postgres

    Note over C: User clicks tile (5, 3)

    C->>C: snapshot pendingRef["5,3"] = current tile state
    C->>C: drawSingleTile(optimisticColor) — instant paint
    C->>S: WS: emit claim_tile {x:5, y:3}

    S->>S: Zod: parse & validate {x,y} bounds
    S->>S: isRateLimited(socket) — 20 msg/5s sliding window

    S->>R: SET cooldown:user:<uuid> 1 NX EX 3
    alt User is on cooldown (key already existed)
        R-->>S: null
        S->>R: PTTL cooldown:user:<uuid>
        R-->>S: 1847 (ms remaining)
        S-->>C: claim_rejected {reason:"cooldown", cooldown_remaining_ms:1847}
        C->>C: claimFlashRef.delete("5,3")
        C->>C: gridStateRef.set("5,3", pendingRef["5,3"]) — revert
        C->>C: redrawAll()
    else Cooldown acquired (key was not set)
        R-->>S: "OK"
        S->>P: upsertUser(uuid, username, color)
        S->>P: UPDATE tiles SET owner=... WHERE x=5 AND y=3 AND owner_id != uuid
        alt Tile owned by this user (self-claim)
            P-->>S: 0 rows
            S-->>C: claim_rejected {reason:"self_owned"}
            C->>C: revert optimistic state
        else Claim succeeds
            P-->>S: 1 row — authoritative tile snapshot
            S--)P: INSERT claims_log ... (fire-and-forget, non-blocking)
            S->>S: io.emit("tile_claimed", tile) — broadcast to ALL rooms
            S-->>C: tile_claimed (authoritative)
            S-->>O: tile_claimed (same broadcast)
            C->>C: gridStateRef.set("5,3", authoritative tile)
            C->>C: claimFlashRef.set("5,3", performance.now())
            C->>C: startFlashLoop() — RAF white overlay, 400ms fade
            O->>O: gridStateRef.set("5,3", tile)
            O->>O: startFlashLoop() — same flash for all clients
        end
    end
```

---

## Data flow: reconnect and state rehydration

The client never trusts its own cached state after a disconnect. It requests a fresh snapshot from the server, which is authoritative.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as API Server
    participant P as Postgres

    Note over C: Network drop / tab sleep / server restart

    C->>C: Socket.IO detects disconnect
    C->>C: Retry queue: 1s → 2s → 4s → 5s → 5s → ...

    loop until connected
        C->>S: TCP + Socket.IO handshake attempt
    end

    S-->>C: connection established (new socket.id)
    C->>S: emit request_snapshot (no payload)

    S->>P: SELECT x,y,owner_id,owner_username,owner_color,claimed_at FROM tiles ORDER BY y,x
    P-->>S: 450 rows (full grid)
    S-->>C: emit init {user, grid: TileSnapshot[450], online_count}

    C->>C: gridStateRef.clear() + repopulate from grid
    C->>C: tileOwnersRef.clear() + rebuild ownership map
    C->>C: leaderMapRef.clear() + rebuild aggregation
    C->>C: flushLeaderboard() → setLeaderEntries()
    C->>C: redrawAll() → full canvas repaint
```

Note: during the disconnect window, `tile_claimed` events from other users are missed. The `request_snapshot` recovery closes that gap — the client gets authoritative state, not a partial diff.

---

## Leaderboard state machine

The leaderboard is computed client-side from socket events, with no backend queries.

```mermaid
flowchart TD
    INIT["init event received<br/>(grid: TileSnapshot[450])"]
    CLAIM["tile_claimed event<br/>(tile: TileSnapshot)"]
    CLEAR["tiles_cleared event<br/>(owner_id, tiles[])"]

    INIT --> A["tileOwnersRef.clear()<br/>leaderMapRef.clear()"]
    A --> B["for each tile with owner_id:<br/>tileOwnersRef.set(key, owner)<br/>leaderMapRef.get(id).tileCount++"]
    B --> FLUSH

    CLAIM --> C{"tile.owner_id<br/>non-null?"}
    C -->|no| DROP["return — ignore<br/>(safety guard)"]
    C -->|yes| D["prevOwner = tileOwnersRef.get(key)"]
    D --> E{"prevOwner exists<br/>AND != new owner?"}
    E -->|yes| F["leaderMapRef.get(prevOwner.id).tileCount--<br/>Math.max(0, count)"]
    E -->|no| G
    F --> G["leaderMapRef.get(newOwner.id).tileCount++<br/>or create entry with tileCount=1"]
    G --> H["tileOwnersRef.set(key, newOwner)"]
    H --> FLUSH

    CLEAR --> I["for each {x,y} in payload.tiles:<br/>prevOwner = tileOwnersRef.get(key)<br/>leaderMapRef.get(prevOwner.id).tileCount--<br/>tileOwnersRef.set(key, null)"]
    I --> FLUSH

    FLUSH["flushLeaderboard()<br/>sort leaderMapRef desc<br/>slice top 10<br/>setLeaderEntries() → re-render"]
```

---

## Concurrency model

Two users claiming the same tile simultaneously is the core conflict scenario. The system resolves it deterministically at the Postgres layer.

```
Timeline (microseconds)
──────────────────────────────────────────────────────────────────

t=0     User A clicks tile (5,3)         User B clicks tile (5,3)
        emit claim_tile                   emit claim_tile

t=1ms   A: Zod passes                    B: Zod passes
        A: rate limit passes             B: rate limit passes

t=2ms   A: Redis SET NX → OK             B: Redis SET NX → OK
        (key: cooldown:user:A)           (key: cooldown:user:B)
        ← different keys, both pass ─────────────────────────────

t=3ms   A: Postgres UPDATE begins         B: Postgres UPDATE begins

t=4ms   Postgres: A acquires row lock for tile (5,3)
                  B blocks — waiting for lock release

t=5ms   A: WHERE (owner_id IS NULL OR owner_id != A) → TRUE
        A: UPDATE succeeds — 1 row returned
        A: lock released

t=6ms   B: row lock acquired
        B: WHERE (owner_id IS NULL OR owner_id != B)
           → owner_id = A's id, and A's id != B's id → TRUE
        B: UPDATE succeeds — tile is now B's!

        ← WAIT — this is the "tile changed hands twice" case ────
        ← That is correct behaviour. If B was faster to DB,
           B wins. If A was faster, A wins. Postgres serializes it.

The "self_owned" path:
        If A claims, then A clicks again before cooldown expires:
        → Redis: cooldown key exists → claim_rejected immediately
        → Postgres never reached

The "lost race" path (only relevant if two users have no cooldown):
        If A is already owner_id = A and B claims:
        → B's UPDATE: WHERE owner_id != B → TRUE (owner is A ≠ B)
        → B wins legitimately. No dedup needed.

Key invariant:
        At most one io.emit('tile_claimed') fires per tile per claim window.
        Postgres RETURNING either gives 0 rows (no broadcast) or 1 row (one broadcast).
```

---

## Horizontal scaling

The Redis adapter is configured even though only one instance is deployed. This means scaling to multiple Railway instances requires no code changes.

```mermaid
graph LR
    subgraph "Browser clients"
        C1[Client 1]
        C2[Client 2]
        C3[Client 3]
    end

    subgraph "Railway — can run N instances"
        API1[API Instance 1<br/>Socket.IO]
        API2[API Instance 2<br/>Socket.IO]
    end

    subgraph "Shared infrastructure"
        RD[(Redis<br/>pub/sub channel)]
        PG[(Postgres<br/>source of truth)]
    end

    C1 <--> API1
    C2 <--> API1
    C3 <--> API2

    API1 -->|claim received| PG
    PG -->|authoritative tile| API1
    API1 -->|PUBLISH tile_claimed| RD
    RD -->|SUBSCRIBE| API1
    RD -->|SUBSCRIBE| API2
    API1 -->|emit to C1, C2| C1
    API1 -->|emit to C1, C2| C2
    API2 -->|emit to C3| C3
```

When Instance 1 receives a claim and broadcasts `io.emit('tile_claimed')`, the Redis adapter publishes to a channel. Instance 2 is subscribed to that channel and re-broadcasts to its own connected clients. Postgres is the single source of truth — both instances read/write the same database.

---

## Key files and their responsibilities

| File | Responsibility |
|---|---|
| `apps/api/src/server.ts` | Startup, CORS, Socket.IO attach, Redis adapter, connection handler |
| `apps/api/src/handlers/claim.ts` | 5-layer claim validation and broadcast |
| `apps/api/src/repos/tiles.ts` | All SQL queries — getAllTiles, atomicClaimTile, clearUserTiles |
| `apps/api/src/lib/pg.ts` | pg.Pool configuration (SSL, timeouts, max connections) |
| `apps/api/src/lib/redis.ts` | Two Redis clients, tryAcquireCooldown |
| `apps/api/scripts/migrate.ts` | Idempotent schema apply + constraint normalization |
| `apps/web/app/page.tsx` | Root component — leaderboard state, socket listeners, sidebar tabs |
| `apps/web/components/grid-canvas.tsx` | Canvas rendering, pan/zoom, optimistic updates, RAF flash |
| `apps/web/lib/socket.ts` | Socket.IO singleton (HMR-safe), reconnection config |
| `apps/web/lib/grid-renderer.ts` | drawGrid, drawSingleTile, pixelToTile, tileToPixel |
| `packages/types/index.ts` | Shared TypeScript interfaces for all socket events |
| `schema.sql` | Database DDL + 450-tile grid seed |
| `railway.json` | Railway build pipeline + deploy config |

---

## If something looks wrong, start here

| Symptom | Where to look |
|---|---|
| Tile changes color on one client but not others | Redis adapter pub/sub — check `REDIS_URL` in Railway env vars |
| Two users both "win" the same tile | Postgres UPDATE — check if `owner_id != $1` WHERE clause is intact |
| Leaderboard count drifts from actual | `tileOwnersRef` — check guard clause `if (!tile.owner_id) return` in `handleTileClaimedForLeader` |
| Flash animation doesn't stop | `flashRafRef` — check that `cancelAnimationFrame` is called in useEffect cleanup |
| Reconnect doesn't restore grid | `request_snapshot` emit — check that socket `connected` check fires after re-register |
