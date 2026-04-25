export interface TileSnapshot {
  x: number;
  y: number;
  owner_id: string | null;
  owner_username: string | null;
  owner_color: string | null;
  claimed_at: string | null;
}

export interface UserInfo {
  id: string;
  username: string;
  color: string;
}

export interface ServerToClientEvents {
  init: (payload: {
    user: UserInfo;
    grid: TileSnapshot[];
    online_count: number;
  }) => void;

  tile_claimed: (payload: {
    x: number;
    y: number;
    owner_id: string;
    owner_username: string;
    owner_color: string;
    claimed_at: string;
  }) => void;

  claim_rejected: (payload: {
    x: number;
    y: number;
    reason: 'cooldown' | 'self_owned' | 'invalid_coords' | 'rate_limit';
    cooldown_remaining_ms?: number;
  }) => void;

  user_joined: (payload: { online_count: number; username: string }) => void;
  user_left: (payload: { online_count: number; username: string }) => void;

  error: (payload: { message: string; code?: string }) => void;
}

export interface ClientToServerEvents {
  claim_tile: (payload: { x: number; y: number }) => void;
  request_snapshot: () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  username: string;
  color: string;
  msgTimestamps: number[];
}
