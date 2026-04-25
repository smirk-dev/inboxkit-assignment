'use client';

import { useEffect, useState } from 'react';
import type { UserInfo } from '@tilewar/types';

const COOLDOWN_MS = 5000;

interface HeaderProps {
  user: UserInfo | null;
  onlineCount: number;
  lastClaimTime: number | null;
}

export function Header({ user, onlineCount, lastClaimTime }: HeaderProps) {
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

  const R = 9;
  const circumference = 2 * Math.PI * R;
  const dashOffset = circumference * (1 - progress);

  return (
    <header className="flex items-center justify-between px-5 py-3 bg-slate-800 border-b border-slate-700 flex-shrink-0 select-none">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold tracking-tight text-white">Tilewar</span>
        <span className="text-xs text-slate-500 hidden sm:inline">— real-time tile capture</span>
      </div>

      <div className="flex items-center gap-5">
        {/* Cooldown ring */}
        {onCooldown && remainingS && (
          <div className="flex items-center gap-2" title={`Cooldown: ${remainingS}s remaining`}>
            <svg width="24" height="24" viewBox="0 0 24 24" className="flex-shrink-0">
              <circle cx="12" cy="12" r={R} fill="none" stroke="#334155" strokeWidth="2.5" />
              <circle
                cx="12" cy="12" r={R}
                fill="none"
                stroke="#3B82F6"
                strokeWidth="2.5"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 12 12)"
                style={{ transition: 'stroke-dashoffset 0.05s linear' }}
              />
            </svg>
            <span className="text-xs tabular-nums text-blue-400 w-8">{remainingS}s</span>
          </div>
        )}

        {/* User identity */}
        {user && (
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full ring-1 ring-slate-600 flex-shrink-0"
              style={{ backgroundColor: user.color }}
            />
            <span className="text-xs font-mono text-slate-300 hidden sm:inline">{user.username}</span>
          </div>
        )}

        {/* Online count */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="text-xs text-slate-400 tabular-nums">{onlineCount} online</span>
        </div>
      </div>
    </header>
  );
}
