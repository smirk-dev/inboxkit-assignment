'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { GridCanvas } from '@/components/grid-canvas';
import { ActivityFeed } from '@/components/activity-feed';
import { Header } from '@/components/header';
import { Leaderboard, type LeaderEntry } from '@/components/leaderboard';
import { getSocket } from '@/lib/socket';
import type { TileSnapshot, UserInfo } from '@tilewar/types';

export default function Home() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [recentClaims, setRecentClaims] = useState<TileSnapshot[]>([]);
  const [lastClaimTime, setLastClaimTime] = useState<number | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'activity' | 'leaderboard'>('activity');
  const [leaderEntries, setLeaderEntries] = useState<LeaderEntry[]>([]);

  // tile key → current owner info (needed to decrement previous owner on claim)
  const tileOwnersRef = useRef<Map<string, { ownerId: string; username: string; color: string } | null>>(new Map());
  // owner id → aggregated entry (mutated in place, flushed to state via flushLeaderboard)
  const leaderMapRef = useRef<Map<string, { username: string; color: string; tileCount: number }>>(new Map());

  const flushLeaderboard = useCallback(() => {
    const entries = Array.from(leaderMapRef.current.entries())
      .filter(([, v]) => v.tileCount > 0)
      .map(([ownerId, v]) => ({ ownerId, ...v }))
      .sort((a, b) => b.tileCount - a.tileCount)
      .slice(0, 10);
    setLeaderEntries(entries);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handleInit = (payload: { user: UserInfo; grid: TileSnapshot[]; online_count: number }) => {
      setUser(payload.user);
      setOnlineCount(payload.online_count);

      // Rebuild leaderboard state from the full grid snapshot
      tileOwnersRef.current.clear();
      leaderMapRef.current.clear();
      for (const tile of payload.grid) {
        const key = `${tile.x},${tile.y}`;
        if (tile.owner_id) {
          tileOwnersRef.current.set(key, { ownerId: tile.owner_id, username: tile.owner_username!, color: tile.owner_color! });
          const entry = leaderMapRef.current.get(tile.owner_id);
          if (entry) {
            entry.tileCount++;
          } else {
            leaderMapRef.current.set(tile.owner_id, { username: tile.owner_username!, color: tile.owner_color!, tileCount: 1 });
          }
        } else {
          tileOwnersRef.current.set(key, null);
        }
      }
      flushLeaderboard();
    };

    const handleUserJoined = ({ online_count }: { online_count: number }) => {
      setOnlineCount(online_count);
    };

    const handleUserLeft = ({ online_count }: { online_count: number }) => {
      setOnlineCount(online_count);
    };

    const handleTileClaimedForLeader = (tile: TileSnapshot) => {
      const key = `${tile.x},${tile.y}`;
      const prevOwner = tileOwnersRef.current.get(key);

      if (prevOwner && prevOwner.ownerId !== tile.owner_id) {
        const prevEntry = leaderMapRef.current.get(prevOwner.ownerId);
        if (prevEntry) prevEntry.tileCount = Math.max(0, prevEntry.tileCount - 1);
      }

      const newEntry = leaderMapRef.current.get(tile.owner_id);
      if (newEntry) {
        newEntry.tileCount++;
        newEntry.username = tile.owner_username!;
        newEntry.color = tile.owner_color!;
      } else {
        leaderMapRef.current.set(tile.owner_id, { username: tile.owner_username!, color: tile.owner_color!, tileCount: 1 });
      }

      tileOwnersRef.current.set(key, { ownerId: tile.owner_id, username: tile.owner_username!, color: tile.owner_color! });
      flushLeaderboard();
    };

    const handleTilesClearedForLeader = (payload: { owner_id: string; tiles: Array<{ x: number; y: number }> }) => {
      for (const { x, y } of payload.tiles) {
        const key = `${x},${y}`;
        const prevOwner = tileOwnersRef.current.get(key);
        if (prevOwner) {
          const entry = leaderMapRef.current.get(prevOwner.ownerId);
          if (entry) entry.tileCount = Math.max(0, entry.tileCount - 1);
        }
        tileOwnersRef.current.set(key, null);
      }
      flushLeaderboard();
    };

    socket.on('init', handleInit);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('tile_claimed', handleTileClaimedForLeader);
    socket.on('tiles_cleared', handleTilesClearedForLeader);

    // If the socket was already connected when this effect ran (e.g. after StrictMode
    // double-invoke or a very fast localhost connection), the server's auto-emitted
    // 'init' was already sent before our handler registered. Request it again.
    if (socket.connected) {
      socket.emit('request_snapshot');
    }

    return () => {
      socket.off('init', handleInit);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('tile_claimed', handleTileClaimedForLeader);
      socket.off('tiles_cleared', handleTilesClearedForLeader);
    };
  }, [flushLeaderboard]);

  // Detect when user tries to close the tab and offer to clean their tiles
  useEffect(() => {
    let leavingFlag = false;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      leavingFlag = true;
      e.preventDefault();
      e.returnValue = '';
    };

    // When window regains focus after beforeunload, the user chose "Stay" — show modal
    const onFocus = () => {
      if (leavingFlag) {
        leavingFlag = false;
        setShowLeaveModal(true);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleTileClaimed = useCallback((tile: TileSnapshot) => {
    setRecentClaims((prev) => [tile, ...prev].slice(0, 10));
  }, []);

  const handleClaimSent = useCallback(() => {
    setLastClaimTime(Date.now());
  }, []);

  const handleCleanAndLeave = () => {
    getSocket().emit('clear_my_tiles');
    setShowLeaveModal(false);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#FFE500' }}>
      <Header user={user} onlineCount={onlineCount} lastClaimTime={lastClaimTime} onCleanSlate={handleCleanAndLeave} />

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area — black background makes tile gaps black */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#000' }}>
          {!user && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: '#FFE500' }}
            >
              <div
                className="flex flex-col items-center gap-3 p-6"
                style={{ border: '3px solid #000', background: '#fff', boxShadow: '4px 4px 0 #000' }}
              >
                <div className="w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-bold" style={{ color: '#000' }}>Connecting…</span>
              </div>
            </div>
          )}
          <GridCanvas
            user={user}
            onTileClaimed={handleTileClaimed}
            onClaimSent={handleClaimSent}
          />
        </div>

        {/* Sidebar: tabbed panel — activity feed or leaderboard */}
        <div
          className="w-56 flex-shrink-0 hidden sm:flex flex-col"
          style={{ borderLeft: '3px solid #000' }}
        >
          <div className="flex flex-shrink-0" style={{ borderBottom: '3px solid #000' }}>
            <button
              className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider"
              style={{
                background: activeTab === 'activity' ? '#FFE500' : '#ffffff',
                color: '#000',
                border: 'none',
                borderRight: '2px solid #000',
                cursor: 'pointer',
              }}
              onClick={() => setActiveTab('activity')}
            >
              Activity
            </button>
            <button
              className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider"
              style={{
                background: activeTab === 'leaderboard' ? '#FFE500' : '#ffffff',
                color: '#000',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => setActiveTab('leaderboard')}
            >
              Top 10
            </button>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'activity'
              ? <ActivityFeed claims={recentClaims} />
              : <Leaderboard entries={leaderEntries} currentUserId={user?.id ?? null} />
            }
          </div>
        </div>
      </div>

      {/* Zoom/pan hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
        <span
          className="text-xs font-medium px-3 py-1"
          style={{ background: '#fff', border: '2px solid #000', boxShadow: '2px 2px 0 #000' }}
        >
          scroll to zoom · drag to pan · click to claim
        </span>
      </div>

      {/* "Clean the Slate?" modal — shown when user stays after trying to close the tab */}
      {showLeaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        >
          <div
            className="p-8 max-w-sm w-full mx-4"
            style={{
              background: '#fff',
              border: '4px solid #000',
              boxShadow: '6px 6px 0 #000',
            }}
          >
            <h2
              className="text-2xl font-bold mb-2"
              style={{ color: '#000', letterSpacing: '-0.03em' }}
            >
              CLEAN YOUR SLATE?
            </h2>
            <p className="text-sm font-medium mb-6" style={{ color: '#555' }}>
              Wipe all your claimed tiles before you go — or leave them as-is.
            </p>
            <div className="flex gap-3">
              <button
                className="brutal-btn flex-1 px-4 py-3 text-sm"
                style={{ background: '#000', color: '#FFE500' }}
                onClick={handleCleanAndLeave}
              >
                CLEAN MY TILES
              </button>
              <button
                className="brutal-btn flex-1 px-4 py-3 text-sm"
                style={{ background: '#FFE500', color: '#000' }}
                onClick={() => setShowLeaveModal(false)}
              >
                KEEP THEM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
