import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@tilewar/types';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

function createSocket(): AppSocket {
  return io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', {
    // polling first → stable connection; Socket.IO upgrades to WebSocket automatically
    transports: ['polling', 'websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}

export function getSocket(): AppSocket {
  if (socket) return socket;

  // In dev, reuse the existing socket across HMR reloads to prevent duplicate connections.
  // The socket is only created here (lazily), never at module-load time, so it doesn't
  // connect before React effects have a chance to register their event handlers.
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const win = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (win.__tilewar_socket) {
      socket = win.__tilewar_socket as AppSocket;
      return socket;
    }
  }

  socket = createSocket();

  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    (window as any).__tilewar_socket = socket; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  return socket;
}
