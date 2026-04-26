import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@tilewar/types';
import { tryAcquireCooldown } from '../lib/redis';
import { atomicClaimTile, logClaim, upsertUser } from '../repos/tiles';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const ClaimPayloadSchema = z.object({
  x: z.number().int().min(0).max(49),
  y: z.number().int().min(0).max(49),
});

const RATE_WINDOW_MS = 5_000;
const RATE_MAX_MSGS = 20;

function isRateLimited(socket: AppSocket): boolean {
  const now = Date.now();
  socket.data.msgTimestamps = (socket.data.msgTimestamps ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (socket.data.msgTimestamps.length >= RATE_MAX_MSGS) return true;
  socket.data.msgTimestamps.push(now);
  return false;
}

export function registerClaimHandler(io: AppServer, socket: AppSocket): void {
  socket.on('claim_tile', (rawPayload) => {
    void handleClaim(io, socket, rawPayload).catch((err) => {
      console.error('claim_tile unhandled error', err);
    });
  });
}

async function handleClaim(
  io: AppServer,
  socket: AppSocket,
  rawPayload: unknown
): Promise<void> {
  // 1. Zod validation
  const parsed = ClaimPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    socket.emit('claim_rejected', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      x: (rawPayload as any)?.x ?? -1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y: (rawPayload as any)?.y ?? -1,
      reason: 'invalid_coords',
    });
    return;
  }
  const { x, y } = parsed.data;

  // 2. Per-socket sliding-window rate limit (in-memory, no Redis needed)
  if (isRateLimited(socket)) {
    socket.emit('claim_rejected', { x, y, reason: 'rate_limit' });
    return;
  }

  // 3. Per-user cooldown via Redis SET NX EX
  const { acquired, remainingMs } = await tryAcquireCooldown(socket.data.userId);
  if (!acquired) {
    socket.emit('claim_rejected', { x, y, reason: 'cooldown', cooldown_remaining_ms: remainingMs });
    return;
  }

  const { userId, username, color } = socket.data;

  // 4. Ensure the user row exists BEFORE updating tiles (tiles.owner_id FK references users.id)
  await upsertUser(userId, username, color);

  // 5. Atomic Postgres claim — race-condition-safe via row-level locking
  const result = await atomicClaimTile(userId, username, color, x, y);
  if (!result.success) {
    socket.emit('claim_rejected', { x, y, reason: 'self_owned' });
    return;
  }

  // 6. Append to audit log (fire-and-forget — failures logged but don't block broadcast)
  logClaim(userId, username, color, x, y, null);

  // 7. Broadcast authoritative tile state to ALL clients
  io.emit('tile_claimed', result.tile!);
}
