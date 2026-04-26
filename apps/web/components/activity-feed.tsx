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
    <aside
      className="h-full flex flex-col"
      style={{ background: '#ffffff' }}
    >
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '3px solid #000' }}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#000' }}>
          Live Activity
        </h2>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {claims.length === 0 && (
          <li className="px-4 py-6 text-xs font-medium text-center" style={{ color: '#555' }}>
            No claims yet — click a tile!
          </li>
        )}
        {claims.map((claim, i) => (
          <li
            key={`${claim.x},${claim.y},${claim.claimed_at ?? i}`}
            className="feed-item-enter px-4 py-2.5 flex items-center gap-3"
            style={{ borderBottom: '2px solid #000' }}
          >
            <div
              className="w-4 h-4 flex-shrink-0"
              style={{
                backgroundColor: claim.owner_color ?? '#EBEBEB',
                border: '2px solid #000',
              }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate leading-tight" style={{ color: '#000' }}>
                {claim.owner_username ?? 'Unknown'}
              </p>
              <p className="text-xs leading-tight mt-0.5" style={{ color: '#555' }}>
                ({claim.x}, {claim.y}) · {timeAgo(claim.claimed_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div
        className="px-4 py-2 flex-shrink-0"
        style={{ borderTop: '3px solid #000' }}
      >
        <p className="text-xs font-medium text-center" style={{ color: '#555' }}>
          last {claims.length} claims
        </p>
      </div>
    </aside>
  );
}
