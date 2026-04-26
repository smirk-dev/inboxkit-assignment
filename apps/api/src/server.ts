import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import { v4 as uuidv4 } from 'uuid';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@tilewar/types';
import { redis, redisSub } from './lib/redis';
import { getAllTiles, clearUserTiles } from './repos/tiles';
import { registerClaimHandler } from './handlers/claim';

const PORT = Number(process.env.PORT ?? 4000);
// Support comma-separated list of allowed origins, e.g. "https://tilewar.vercel.app,http://localhost:3000"
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // server-to-server or same-origin
  return ALLOWED_ORIGINS.includes(origin);
}

const COLOR_PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#6366F1', '#A855F7',
  '#EC4899', '#F43F5E', '#84CC16', '#06B6D4',
];

function usernameToColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

async function handleConnection(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  socket: import('socket.io').Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
): Promise<void> {
  const base = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  });
  const username = `${base}-${Math.floor(Math.random() * 100)}`;
  const userId = uuidv4();
  const color = usernameToColor(username);

  socket.data = { userId, username, color, msgTimestamps: [] };

  const grid = await getAllTiles();
  const onlineCount = io.sockets.sockets.size;

  socket.emit('init', { user: { id: userId, username, color }, grid, online_count: onlineCount });
  socket.broadcast.emit('user_joined', { online_count: onlineCount, username });

  registerClaimHandler(io, socket);

  socket.on('clear_my_tiles', () => {
    void clearUserTiles(socket.data.userId).then((tiles) => {
      if (tiles.length > 0) {
        io.emit('tiles_cleared', { owner_id: socket.data.userId, tiles });
      }
    }).catch((err) => console.error('clear_my_tiles error', err));
  });

  socket.on('request_snapshot', () => {
    void getAllTiles().then((freshGrid) => {
      socket.emit('init', {
        user: { id: socket.data.userId, username: socket.data.username, color: socket.data.color },
        grid: freshGrid,
        online_count: io.sockets.sockets.size,
      });
    }).catch((err) => console.error('request_snapshot error', err));
  });

  socket.on('disconnect', () => {
    const count = io.sockets.sockets.size;
    io.emit('user_left', { online_count: count, username: socket.data.username });
  });
}

async function main() {
  const missingVars = ['DATABASE_URL', 'REDIS_URL'].filter((k) => !process.env[k]);
  if (missingVars.length) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  await redis.connect();
  await redisSub.connect();

  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(app.server, {
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    perMessageDeflate: true,
    transports: ['websocket', 'polling'],
  });

  io.adapter(createAdapter(redis, redisSub));

  io.on('connection', (socket) => {
    // Wrap async setup in a named function so unhandled rejections don't crash the process
    void handleConnection(io, socket).catch((err) => {
      console.error('Connection handler error', err);
      socket.disconnect(true);
    });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API listening on :${PORT}`);
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
