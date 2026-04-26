'use client';

import { useEffect, useState } from 'react';
import type { UserInfo } from '@tilewar/types';

const COOLDOWN_MS = 5000;

interface HeaderProps {
  user: UserInfo | null;
  onlineCount: number;
  lastClaimTime: number | null;
  onCleanSlate: () => void;
}

export function Header({ user, onlineCount, lastClaimTime, onCleanSlate }: HeaderProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!lastClaimTime) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const interval = setInterval(() => {
      const e = Date.now() - lastClaimTime;
      setElapsed(e);
      if (e >= COOLDOWN_MS) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [lastClaimTime]);

  const onCooldown = lastClaimTime !== null && elapsed < COOLDOWN_MS;
  const progress = onCooldown ? elapsed / COOLDOWN_MS : 1;
  const remainingS = onCooldown ? ((COOLDOWN_MS - elapsed) / 1000).toFixed(1) : null;

  return (
    <header
      className="flex items-center justify-between px-5 py-3 flex-shrink-0 select-none"
      style={{ background: '#ffffff', borderBottom: '3px solid #000' }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl font-bold" style={{ color: '#000', letterSpacing: '-0.03em' }}>
          TILEWAR
        </span>
        <span className="text-xs font-medium hidden sm:inline" style={{ color: '#555' }}>
          real-time tile capture
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Cooldown bar */}
        {onCooldown && remainingS && (
          <div
            className="flex items-center gap-2 px-3 py-1"
            style={{ border: '2px solid #000', background: '#FFE500' }}
            title={`Cooldown: ${remainingS}s remaining`}
          >
            <div
              className="relative h-2 w-20"
              style={{ background: '#ddd', border: '1px solid #000' }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${progress * 100}%`,
                  background: '#000',
                  transition: 'width 0.05s linear',
                }}
              />
            </div>
            <span className="text-xs font-bold tabular-nums" style={{ color: '#000' }}>
              {remainingS}s
            </span>
          </div>
        )}

        {/* User identity */}
        {user && (
          <div
            className="flex items-center gap-2 px-3 py-1"
            style={{ border: '2px solid #000', background: '#fff' }}
          >
            <div
              className="w-4 h-4 flex-shrink-0"
              style={{ backgroundColor: user.color, border: '2px solid #000' }}
            />
            <span className="text-xs font-bold hidden sm:inline" style={{ color: '#000' }}>
              {user.username}
            </span>
          </div>
        )}

        {/* Online count */}
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: '#22C55E', border: '2px solid #000' }}
          />
          <span className="text-sm font-bold tabular-nums" style={{ color: '#000' }}>
            {onlineCount} online
          </span>
        </div>

        {/* Clean Slate button */}
        {user && (
          <button
            className="brutal-btn px-3 py-1 text-xs"
            style={{ background: '#ff4d4d', color: '#fff' }}
            onClick={onCleanSlate}
            title="Clear all your claimed tiles"
          >
            CLEAN SLATE
          </button>
        )}
      </div>
    </header>
  );
}
