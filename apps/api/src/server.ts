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
import { getAllTiles } from './repos/tiles';
import { registerClaimHandler } from './handlers/claim';

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

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

async function main() {
  await redis.connect();
  await redisSub.connect();

  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(app.server, {
    cors: {
      origin: FRONTEND_URL,
      methods: ['GET', 'POST'],
    },
    perMessageDeflate: true,
    transports: ['websocket', 'polling'],
  });

  io.adapter(createAdapter(redis, redisSub));

  io.on('connection', async (socket) => {
    // Generate a unique anonymous identity for this session
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

    const [grid] = await Promise.all([getAllTiles()]);
    const onlineCount = io.sockets.sockets.size;

    socket.emit('init', {
      user: { id: userId, username, color },
      grid,
      online_count: onlineCount,
    });

    socket.broadcast.emit('user_joined', { online_count: onlineCount, username });

    registerClaimHandler(io, socket);

    socket.on('request_snapshot', async () => {
      const freshGrid = await getAllTiles();
      socket.emit('init', {
        user: { id: socket.data.userId, username: socket.data.username, color: socket.data.color },
        grid: freshGrid,
        online_count: io.sockets.sockets.size,
      });
    });

    socket.on('disconnect', () => {
      const count = io.sockets.sockets.size;
      io.emit('user_left', { online_count: count, username: socket.data.username });
    });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API listening on :${PORT}`);
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
