# WebSocket event contract

All events flow over a single Socket.IO connection. Payloads are JSON, validated with Zod on the server. Unknown events are dropped silently. Malformed payloads return `error` with the validation message.

The server is the only authority. The client may render optimistically but must reconcile against any authoritative event from the server.

---

## Connection lifecycle

### Server → client

#### `init`
Emitted once on successful connect (or reconnect).

```ts
{
  user: {
    id: string;        // UUID
    username: string;  // e.g. "wild-otter-42"
    color: string;     // hex, e.g. "#7F77DD"
  };
  grid: Array<{
    x: number;
    y: number;
    owner_id: string | null;
    owner_username: string | null;
    owner_color: string | null;
    claimed_at: string | null; // ISO 8601
  }>;
  online_count: number;
}
```

#### `error`
Generic server-side error.

```ts
{ message: string; code?: string }
```

---

## Claim flow

### Client → server

#### `claim_tile`
The user wants to take a tile.

```ts
{ x: number; y: number }   // 0 ≤ x, y < 50
```

Server validation order (any failure short-circuits):
1. Coordinate bounds.
2. Per-socket rate limit (sliding window).
3. Per-user cooldown via Redis `SET NX EX`.
4. Atomic Postgres `UPDATE ... RETURNING`.

### Server → client (private — only the requester)

#### `claim_rejected`
The claim could not be applied. Client rolls back any optimistic state.

```ts
{
  x: number;
  y: number;
  reason: 'cooldown' | 'self_owned' | 'invalid_coords' | 'rate_limit';
  cooldown_remaining_ms?: number;  // when reason === 'cooldown'
}
```

### Server → client (broadcast to all)

#### `tile_claimed`
The authoritative tile state after a successful claim. Receiving clients patch their grid to match.

```ts
{
  x: number;
  y: number;
  owner_id: string;
  owner_username: string;
  owner_color: string;
  claimed_at: string;  // ISO 8601
}
```

---

## Presence

### Server → client (broadcast)

#### `user_joined`

```ts
{ online_count: number; username: string }
```

#### `user_left`

```ts
{ online_count: number; username: string }
```

---

## Recovery

### Client → server

#### `request_snapshot`
After a long disconnect or suspected desync, ask for a fresh snapshot. The server replies with `init` (same shape).

No payload.

---

## Rate limits

| Limit | Scope | Mechanism | Behavior on breach |
|---|---|---|---|
| 20 messages / 5 seconds | Per socket (sliding window) | In-memory | Server emits `claim_rejected { reason: 'rate_limit' }`, ignores further messages briefly |
| 1 successful claim / 5 seconds | Per user | Redis `SET NX EX 5` | Server emits `claim_rejected { reason: 'cooldown', cooldown_remaining_ms }` |
| 100 connections / IP | Per IP | Connection-handler level | TCP connection rejected before WebSocket upgrade |

Cooldown timing is enforced server-side only. The client UI hint is advisory — never the gate.

---

## Versioning

Schemas are versioned via the connection handshake (`X-Tilewar-Protocol: v1`). Future breaking changes increment the version and run side-by-side until clients have migrated.
