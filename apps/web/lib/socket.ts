import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@tilewar/types';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (socket) return socket;

  socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000', {
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

// In dev, store the socket on window to survive HMR without creating duplicate connections
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  if (win.__tilewar_socket) {
    socket = win.__tilewar_socket;
  } else {
    win.__tilewar_socket = getSocket();
  }
}
