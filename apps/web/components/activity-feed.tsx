'use client';

import type { TileSnapshot } from '@tilewar/types';

interface ActivityFeedProps {
  claims: TileSnapshot[];
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return '';
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 5000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  return `${Math.floor(ms / 60_000)}m ago`;
}

export function ActivityFeed({ claims }: ActivityFeedProps) {
  return (
    <aside className="h-full flex flex-col bg-slate-850 border-l border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Live Activity
        </h2>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {claims.length === 0 && (
          <li className="px-4 py-6 text-xs text-slate-500 text-center">
            No claims yet — click a tile!
          </li>
        )}
        {claims.map((claim, i) => (
          <li
            key={i}
            className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
          >
            <div
              className="w-3 h-3 rounded-sm flex-shrink-0 ring-1 ring-black/20"
              style={{ backgroundColor: claim.owner_color ?? '#1E293B' }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate leading-tight">
                {claim.owner_username ?? 'Unknown'}
              </p>
              <p className="text-xs text-slate-500 leading-tight mt-0.5">
                ({claim.x}, {claim.y}) · {timeAgo(claim.claimed_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="px-4 py-2 border-t border-slate-700 flex-shrink-0">
        <p className="text-xs text-slate-600 text-center">last {claims.length} claims</p>
      </div>
    </aside>
  );
}
