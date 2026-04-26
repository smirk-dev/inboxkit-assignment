'use client';

export interface LeaderEntry {
  ownerId: string;
  username: string;
  color: string;
  tileCount: number;
}

interface LeaderboardProps {
  entries: LeaderEntry[];
  currentUserId: string | null;
}

export function Leaderboard({ entries, currentUserId }: LeaderboardProps) {
  const totalTiles = entries.reduce((sum, e) => sum + e.tileCount, 0);

  return (
    <aside className="h-full flex flex-col" style={{ background: '#ffffff' }}>
      <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '3px solid #000' }}>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#000' }}>
          Top 10
        </h2>
      </div>

      <ol className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <li className="px-4 py-6 text-xs font-medium text-center" style={{ color: '#555' }}>
            No tiles claimed yet
          </li>
        )}
        {entries.map((entry, i) => {
          const isCurrentUser = entry.ownerId === currentUserId;
          const isFirst = i === 0;
          return (
            <li
              key={entry.ownerId}
              className="leaderboard-row-enter px-3 py-2 flex items-center gap-2"
              style={{
                borderBottom: '2px solid #000',
                borderLeft: isCurrentUser ? '4px solid #000' : '4px solid transparent',
                background: isFirst ? '#FFE500' : '#ffffff',
              }}
            >
              <span
                className="text-xs font-bold tabular-nums flex-shrink-0"
                style={{ width: '1.1rem', color: '#000' }}
              >
                {i + 1}
              </span>
              <div
                className="flex-shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: entry.color,
                  border: '2px solid #000',
                }}
              />
              <span className="text-xs font-medium flex-1 truncate" style={{ color: '#000' }}>
                {entry.username}
              </span>
              <span
                className="text-xs font-bold tabular-nums flex-shrink-0 px-1.5 py-0.5"
                style={{ background: '#000', color: '#FFE500', fontSize: '0.65rem' }}
              >
                {entry.tileCount}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="px-4 py-2 flex-shrink-0" style={{ borderTop: '3px solid #000' }}>
        <p className="text-xs font-medium text-center" style={{ color: '#555' }}>
          {totalTiles} tile{totalTiles !== 1 ? 's' : ''} held
        </p>
      </div>
    </aside>
  );
}
