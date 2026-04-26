# Deployment

> **Quick orientation**
> - This file covers everything needed to deploy, operate, and debug the production system.
> - The most common failure modes are documented at the bottom with exact fixes.
> - For the application architecture, see [architecture.md](./architecture.md). For environment variables used in application code, see [backend.md](./backend.md).

---

## Architecture at deploy time

```mermaid
graph TD
    GH["GitHub: main branch push"]

    GH -->|auto-deploy trigger| VB
    GH -->|auto-deploy trigger| RB

    subgraph "Vercel (frontend)"
        VB["vercel build<br/>npx turbo run build --filter=@tilewar/web<br/>next build → .next/"]
        VD["Vercel CDN<br/>Edge network, global PoPs"]
    end

    subgraph "Railway (backend)"
        RB["nixpacks build<br/>npm install --include=dev<br/>turbo build --filter=@tilewar/api<br/>npm run db:migrate"]
        RD["node apps/api/dist/server.js<br/>Fastify on 0.0.0.0:PORT"]
        RR["Railway Redis add-on<br/>Cooldown keys + pub/sub"]
    end

    subgraph "Supabase (database)"
        SP["PostgreSQL<br/>Session Mode Pooler (IPv4)<br/>aws-0-region.pooler.supabase.com:5432"]
    end

    VB --> VD
    RB --> RD
    RD <-->|pg.Pool| SP
    RD <-->|ioredis| RR
    VD <-->|WebSocket / HTTPS| RD
```

---

## Railway deployment

### `railway.json` — field by field

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install --include=dev && npx turbo run build --filter=@tilewar/api && npm run db:migrate",
    "watchPatterns": [
      "apps/api/**",
      "packages/types/**",
      "schema.sql",
      "package.json",
      "package-lock.json",
      "turbo.json"
    ]
  },
  "deploy": {
    "startCommand": "node apps/api/dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

| Field | Value | Why |
|---|---|---|
| `builder` | `NIXPACKS` | Railway's default Linux container builder. Auto-detects Node.js from `package.json`. |
| `buildCommand` | `npm install --include=dev && ...` | `--include=dev` installs devDependencies even though `NODE_ENV=production` is set. `tsx` and `turbo` are devDeps but needed in the build container. |
| `buildCommand` (turbo filter) | `--filter=@tilewar/api` | Turbo's `dependsOn: ["^build"]` in `turbo.json` automatically builds `@tilewar/types` first (which `@tilewar/api` depends on). |
| `buildCommand` (migrate) | `npm run db:migrate` | Runs as the last build step. Build fails visibly if migration fails — the old deployment keeps serving. |
| `watchPatterns` | `apps/api/**`, `packages/types/**`, etc. | Railway only rebuilds when these files change. Frontend-only changes don't trigger a Railway redeploy. |
| `startCommand` | `node apps/api/dist/server.js` | Runs the compiled JavaScript directly. No `tsx`, no TypeScript at runtime. |
| `healthcheckPath` | `/health` | Railway probes `GET /health` after start. Returns `{ ok: true, ts: ISO8601 }`. |
| `healthcheckTimeout` | `60` seconds | Allows time for Redis connect + Postgres pool warmup before Railway considers the deploy failed. |
| `restartPolicyType` | `ON_FAILURE` | Restarts the process if it crashes. Max 3 retries before Railway marks the deploy as failed. |

### Build pipeline in detail

```
Railway build container (NIXPACKS, Debian-based)
│
├─ npm install --include=dev
│   └─ installs ALL deps including typescript, tsx, turbo
│
├─ npx turbo run build --filter=@tilewar/api
│   ├─ @tilewar/types:build (dependency, runs first)
│   │   └─ tsc → packages/types/dist/
│   └─ @tilewar/api:build
│       └─ tsc → apps/api/dist/
│           └─ dist/server.js (entrypoint)
│               dist/handlers/claim.js
│               dist/repos/tiles.js
│               dist/lib/pg.js
│               dist/lib/redis.js
│
└─ npm run db:migrate
    └─ tsx scripts/migrate.ts
        ├─ Apply schema.sql (CREATE TABLE IF NOT EXISTS)
        └─ Normalize constraints (DROP/ADD CHECK)
```

---

## Environment variables

All variables are set in the Railway service's **Variables** panel (not in code).

### Railway (API service)

| Variable | Example value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.[ref]:[pass]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` | **Must be Session Mode Pooler URL** (IPv4). Direct URL (`db.[ref].supabase.co`) is IPv6 and unreachable from Railway. |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Railway reference syntax — auto-injects the Redis add-on URL. Do NOT hardcode. |
| `FRONTEND_URL` | `https://inboxkit-assignment-web.vercel.app` | The Vercel production domain. Comma-separate for multiple origins. Preview deployments need their own entry. |
| `NODE_ENV` | `production` | Set by Railway automatically. Enables SSL for Postgres in `pg.ts`. |
| `PORT` | (auto-injected) | Railway injects this. The server reads `process.env.PORT ?? 4000`. |

### Vercel (web app)

| Variable | Example value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://inboxkit-assignment-production.up.railway.app` | The Railway service domain. Must be `NEXT_PUBLIC_` prefix for client-side access. |

### Railway reference syntax

When the Redis add-on is added to the Railway project, it creates a service named `Redis`. To inject its URL into the API service:

```
Variable name:  REDIS_URL
Variable value: ${{Redis.REDIS_URL}}
```

The `${{ServiceName.VARIABLE}}` syntax is Railway's reference injection — it replaces the value at deploy time with the actual Redis URL (including credentials). This is NOT a shell variable — it must be set in Railway's UI, not in `.env` files or code.

---

## Vercel deployment

The frontend deploys automatically on push to `main`. Vercel detects Next.js and runs:

```
cd apps/web && npm install && next build
```

Vercel's project settings point the root directory to `apps/web`. The Turbo pipeline is handled by Vercel's native Turbo integration (detected automatically from `turbo.json`).

**Why Vercel for the frontend?** Next.js App Router works best on Vercel — it's the reference deployment platform. More importantly, the API **cannot** be deployed to Vercel because Socket.IO requires a persistent process. Vercel serverless functions timeout at 10–30 seconds and don't hold open WebSocket connections.

**Environment variable on Vercel:**
Set `NEXT_PUBLIC_API_URL` in Vercel's project settings → Environment Variables → Production:
```
NEXT_PUBLIC_API_URL = https://inboxkit-assignment-production.up.railway.app
```

---

## Supabase / PostgreSQL

### Session Mode Pooler vs. Direct connection

| | Direct connection | Session Mode Pooler |
|---|---|---|
| **URL format** | `db.[ref].supabase.co:5432` | `aws-0-[region].pooler.supabase.com:5432` |
| **IP protocol** | IPv6 | IPv4 |
| **Railway compatibility** | ❌ Railway is IPv4-only | ✅ |
| **SSL** | Required | Required |
| **Connection limits** | Per-project limit | Same per-project limit |

**Always use the Session Mode Pooler URL for Railway.** The direct connection resolves to an IPv6 address in newer AWS regions, which Railway's infrastructure cannot reach (`ENETUNREACH`).

### Finding the pooler URL

In Supabase dashboard → Settings → Database → Connection string → Session mode:
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

### SSL configuration in code

```typescript
// apps/api/src/lib/pg.ts
ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
```

`rejectUnauthorized: false` is required because Supabase's pooler presents a certificate from an intermediate CA that Node.js doesn't trust by default. The connection is still TLS-encrypted — `rejectUnauthorized` only disables certificate chain validation, not encryption.

---

## Redis add-on

Railway Redis is provisioned from the Railway project dashboard → New → Database → Redis. Once provisioned, it appears as a service named `Redis` in the project.

Two Redis clients are needed in the API code:

```typescript
// apps/api/src/lib/redis.ts
export const redis    = new Redis(process.env.REDIS_URL!); // regular commands
export const redisSub = new Redis(process.env.REDIS_URL!); // pub/sub subscriptions
```

A Redis client in subscribe mode cannot issue regular commands. The Socket.IO Redis adapter uses `redisSub` for subscriptions and `redis` for everything else.

---

## CI/CD flow

```
git push origin main
         │
         ├──────────────────────────────────────────►  Vercel
         │                                             Detects Next.js change
         │                                             Runs: next build
         │                                             Deploys to CDN edge
         │
         └──────────────────────────────────────────►  Railway
                                                       watchPatterns check
                                                       If api/** or types/** changed:
                                                         npm install --include=dev
                                                         turbo build --filter=@tilewar/api
                                                         npm run db:migrate
                                                         → start new container
                                                         → health check /health
                                                         → swap traffic
```

**Zero-downtime deploys on Railway:** Railway starts the new container alongside the old one, waits for the health check to pass, then routes traffic to the new container and stops the old one. WebSocket connections on the old container are dropped at this point — clients reconnect automatically via Socket.IO's reconnection logic and receive fresh state via `request_snapshot`.

---

## Common failure modes and fixes

### CORS error: `No 'Access-Control-Allow-Origin' header`

```
Access to XMLHttpRequest at 'https://...railway.app/socket.io/...'
from origin 'https://...vercel.app' has been blocked by CORS policy
```

**Cause:** `FRONTEND_URL` on Railway doesn't include the Vercel origin.

**Fix:**
1. In Railway Variables, set `FRONTEND_URL` to the exact Vercel URL (no trailing slash):
   ```
   FRONTEND_URL=https://inboxkit-assignment-web.vercel.app
   ```
2. For Vercel preview deployments, the URL changes per commit. Either:
   - Add the preview domain manually: `FRONTEND_URL=https://prod.vercel.app,https://preview.vercel.app`
   - Or open CORS to all Vercel subdomains (not recommended for production)
3. Redeploy the Railway service.

---

### ENETUNREACH (IPv6 connection failure)

```
ENETUNREACH 2406:da18:243:7420:785d:8501:aff0:b73c:5432
```

**Cause:** `DATABASE_URL` is the Supabase direct connection, which resolves to IPv6. Railway's network is IPv4-only.

**Fix:** Switch `DATABASE_URL` to the Session Mode Pooler URL:
```
postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres
```
Find this in Supabase → Settings → Database → Connection string → Session mode.

---

### Missing `REDIS_URL` / Redis not connecting

```
Error: Missing required environment variables: REDIS_URL
```
or silent connection failure after startup.

**Cause:** `REDIS_URL` not injected into the API service. Railway does NOT auto-inject add-on variables — you must set the reference manually.

**Fix:** In Railway → API service → Variables:
```
REDIS_URL = ${{Redis.REDIS_URL}}
```
The `${{Redis.REDIS_URL}}` syntax resolves to the actual Redis URL at deploy time. Do not use `$Redis.REDIS_URL` or `${Redis.REDIS_URL}` — Railway's specific syntax requires double braces.

---

### Migration failure: `relation "tiles" does not exist`

```
error: relation "tiles" does not exist
```

**Cause:** The migration script previously ran the normalization steps (DELETE FROM tiles, ALTER TABLE tiles) before applying the schema. On a fresh database, the `tiles` table doesn't exist yet.

**Fix:** This has already been fixed in `apps/api/scripts/migrate.ts` — `schema.sql` is applied first (creating all tables), then the normalization queries run. If this error reappears, check that the schema application step precedes any ALTER TABLE calls.

---

### TypeScript build failure: `Type 'null' is not assignable to type 'string'`

```
Type error: Argument of type 'string | null' is not assignable to parameter of type 'string'.
```

**Cause:** `TileSnapshot.owner_id` is typed `string | null`, but `Map.get()` requires `string`.

**Fix:** Add a null guard at the start of `handleTileClaimedForLeader` in `page.tsx`:
```typescript
if (!tile.owner_id) return;
```
This has been applied. If it reappears in a new event handler, add the same guard.

---

### Leaderboard counts wrong after deployment

After a fresh deploy, clients reconnect and receive a new `init` event. The leaderboard refs are rebuilt from the grid snapshot in `handleInit`. If counts appear wrong:

1. Check that `tileOwnersRef` and `leaderMapRef` are both `.clear()`ed before repopulation in `handleInit`.
2. Check that `flushLeaderboard()` is called after repopulation.
3. Verify that `handleTileClaimedForLeader` is registered on the same socket as `handleInit` (same `useEffect` in `page.tsx`).

---

### Health check failing (service marked unhealthy)

Railway probes `GET /health` after start. If it returns non-200 or times out (60s), the deploy is marked failed.

Common causes:
- **Redis not connecting:** `await redis.connect()` throws if `REDIS_URL` is wrong. Check logs for Redis connection errors.
- **Postgres not connecting:** `getAllTiles()` on first connection blocks until the pool connects. Check `DATABASE_URL` and that the Supabase pooler is reachable.
- **Port mismatch:** Server must listen on `0.0.0.0:PORT` where `PORT` is Railway's injected value. Check `app.listen({ port: PORT, host: '0.0.0.0' })`.

To debug: check Railway's deploy logs (not runtime logs) for the startup sequence. The env var validation at the top of `main()` gives explicit error messages.
