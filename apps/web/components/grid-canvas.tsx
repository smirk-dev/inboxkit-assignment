'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { TileSnapshot, UserInfo } from '@tilewar/types';
import { getSocket } from '@/lib/socket';
import {
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  drawGrid,
  drawSingleTile,
  pixelToTile,
  type Transform,
} from '@/lib/grid-renderer';

interface GridCanvasProps {
  user: UserInfo | null;
  onTileClaimed: (tile: TileSnapshot) => void;
  onClaimSent: () => void;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 5;

export function GridCanvas({ user, onTileClaimed, onClaimSent }: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridStateRef = useRef<Map<string, TileSnapshot>>(new Map());
  const transformRef = useRef<Transform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  // Stores the pre-claim tile state for optimistic rollback
  const pendingRef = useRef<Map<string, TileSnapshot | null>>(new Map());
  const panRef = useRef({ isDragging: false, startX: 0, startY: 0, startOffX: 0, startOffY: 0 });
  const userRef = useRef<UserInfo | null>(null);
  const centeredRef = useRef(false);

  useEffect(() => { userRef.current = user; }, [user]);

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null;

  const redrawAll = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    drawGrid(ctx, gridStateRef.current, transformRef.current, hoverRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;

      // Fit the entire grid in view on first load so no tiles are offscreen.
      // Scale down if the grid is wider/taller than the canvas; never scale above 1x.
      if (!centeredRef.current) {
        centeredRef.current = true;
        const scaleToFit = Math.min(
          rect.width  / (GRID_COLS * TILE_SIZE),
          rect.height / (GRID_ROWS * TILE_SIZE),
          1
        );
        const gridW = GRID_COLS * TILE_SIZE * scaleToFit;
        const gridH = GRID_ROWS * TILE_SIZE * scaleToFit;
        transformRef.current = {
          scale: scaleToFit,
          offsetX: (rect.width  - gridW) / 2,
          offsetY: (rect.height - gridH) / 2,
        };
      }
      redrawAll();
    };
    resize();
    window.addEventListener('resize', resize);

    const socket = getSocket();

    const handleInit = (payload: { grid: TileSnapshot[]; user: UserInfo; online_count: number }) => {
      gridStateRef.current.clear();
      for (const tile of payload.grid) {
        gridStateRef.current.set(`${tile.x},${tile.y}`, tile);
      }
      redrawAll();
    };

    const handleTileClaimed = (tile: TileSnapshot) => {
      const key = `${tile.x},${tile.y}`;
      gridStateRef.current.set(key, tile);
      pendingRef.current.delete(key);
      const ctx = getCtx();
      if (ctx) {
        const isHovered = hoverRef.current?.x === tile.x && hoverRef.current?.y === tile.y;
        drawSingleTile(ctx, tile, transformRef.current, isHovered);
      }
      onTileClaimed(tile);
    };

    const handleClaimRejected = (payload: { x: number; y: number; reason: string }) => {
      const key = `${payload.x},${payload.y}`;
      if (!pendingRef.current.has(key)) return;
      const prev = pendingRef.current.get(key);
      pendingRef.current.delete(key);
      if (prev === null) {
        gridStateRef.current.delete(key);
      } else if (prev !== undefined) {
        gridStateRef.current.set(key, prev);
      }
      redrawAll();
    };

    const handleTilesCleared = (payload: { owner_id: string; tiles: Array<{ x: number; y: number }> }) => {
      for (const { x, y } of payload.tiles) {
        gridStateRef.current.delete(`${x},${y}`);
      }
      redrawAll();
    };

    socket.on('init', handleInit);
    socket.on('tile_claimed', handleTileClaimed);
    socket.on('claim_rejected', handleClaimRejected);
    socket.on('tiles_cleared', handleTilesCleared);

    // Recovery: if socket already connected before this effect ran, request fresh init
    if (socket.connected) {
      socket.emit('request_snapshot');
    }

    return () => {
      window.removeEventListener('resize', resize);
      socket.off('init', handleInit);
      socket.off('tile_claimed', handleTileClaimed);
      socket.off('claim_rejected', handleClaimRejected);
      socket.off('tiles_cleared', handleTilesCleared);
    };
  }, [redrawAll, onTileClaimed]);

  const handleMouseDown = (e: React.MouseEvent) => {
    panRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startOffX: transformRef.current.offsetX,
      startOffY: transformRef.current.offsetY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (panRef.current.isDragging) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      transformRef.current = {
        ...transformRef.current,
        offsetX: panRef.current.startOffX + dx,
        offsetY: panRef.current.startOffY + dy,
      };
      redrawAll();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const tile = pixelToTile(canvasX, canvasY, transformRef.current);

    if (tile?.x !== hoverRef.current?.x || tile?.y !== hoverRef.current?.y) {
      hoverRef.current = tile;
      redrawAll();
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wasDrag =
      Math.abs(e.clientX - panRef.current.startX) > 4 ||
      Math.abs(e.clientY - panRef.current.startY) > 4;
    panRef.current.isDragging = false;
    if (wasDrag) return;

    const currentUser = userRef.current;
    if (!currentUser) return;

    const rect = canvas.getBoundingClientRect();
    const tile = pixelToTile(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;
    const current = gridStateRef.current.get(key) ?? null;
    pendingRef.current.set(key, current);

    // Optimistic update — show our color immediately
    const optimisticTile: TileSnapshot = {
      x: tile.x,
      y: tile.y,
      owner_id: currentUser.id,
      owner_username: currentUser.username,
      owner_color: currentUser.color,
      claimed_at: new Date().toISOString(),
    };
    gridStateRef.current.set(key, optimisticTile);
    const ctx = getCtx();
    if (ctx) drawSingleTile(ctx, optimisticTile, transformRef.current, true);

    getSocket().emit('claim_tile', { x: tile.x, y: tile.y });
    onClaimSent();
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transformRef.current.scale * factor));
    const scaleDelta = newScale - transformRef.current.scale;

    transformRef.current = {
      scale: newScale,
      offsetX: transformRef.current.offsetX - mouseX * (scaleDelta / transformRef.current.scale),
      offsetY: transformRef.current.offsetY - mouseY * (scaleDelta / transformRef.current.scale),
    };
    redrawAll();
  };

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full"
      style={{ cursor: 'crosshair', backgroundColor: '#000' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        panRef.current.isDragging = false;
        hoverRef.current = null;
        redrawAll();
      }}
      onWheel={handleWheel}
    />
  );
}
