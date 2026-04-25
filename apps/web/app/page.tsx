'use client';

import { useEffect, useState, useCallback } from 'react';
import { GridCanvas } from '@/components/grid-canvas';
import { ActivityFeed } from '@/components/activity-feed';
import { Header } from '@/components/header';
import { getSocket } from '@/lib/socket';
import type { TileSnapshot, UserInfo } from '@tilewar/types';

export default function Home() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [recentClaims, setRecentClaims] = useState<TileSnapshot[]>([]);
  const [lastClaimTime, setLastClaimTime] = useState<number | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const handleInit = (payload: { user: UserInfo; grid: TileSnapshot[]; online_count: number }) => {
      setUser(payload.user);
      setOnlineCount(payload.online_count);
    };

    const handleUserJoined = ({ online_count }: { online_count: number }) => {
      setOnlineCount(online_count);
    };

    const handleUserLeft = ({ online_count }: { online_count: number }) => {
      setOnlineCount(online_count);
    };

    socket.on('init', handleInit);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);

    return () => {
      socket.off('init', handleInit);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
    };
  }, []);

  const handleTileClaimed = useCallback((tile: TileSnapshot) => {
    setRecentClaims((prev) => [tile, ...prev].slice(0, 10));
  }, []);

  const handleClaimSent = useCallback(() => {
    setLastClaimTime(Date.now());
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">
      <Header user={user} onlineCount={onlineCount} lastClaimTime={lastClaimTime} />

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden bg-slate-900">
          {!user && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Connecting…</span>
              </div>
            </div>
          )}
          <GridCanvas
            user={user}
            onTileClaimed={handleTileClaimed}
            onClaimSent={handleClaimSent}
          />
        </div>

        {/* Activity feed sidebar */}
        <div className="w-56 flex-shrink-0 hidden sm:flex flex-col">
          <ActivityFeed claims={recentClaims} />
        </div>
      </div>

      {/* Zoom/pan hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
        <span className="text-xs text-slate-600 bg-slate-900/80 px-3 py-1 rounded-full">
          scroll to zoom · drag to pan · click to claim
        </span>
      </div>
    </div>
  );
}
