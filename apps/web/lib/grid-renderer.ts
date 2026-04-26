import type { TileSnapshot } from '@tilewar/types';

export const GRID_COLS = 30;
export const GRID_ROWS = 15;
export const TILE_SIZE = 40;

const EMPTY_COLOR = '#EBEBEB';
const HOVER_OVERLAY = 'rgba(0,0,0,0.15)';

export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function pixelToTile(
  canvasX: number,
  canvasY: number,
  transform: Transform
): { x: number; y: number } | null {
  const tileX = Math.floor((canvasX - transform.offsetX) / (TILE_SIZE * transform.scale));
  const tileY = Math.floor((canvasY - transform.offsetY) / (TILE_SIZE * transform.scale));
  if (tileX < 0 || tileX >= GRID_COLS || tileY < 0 || tileY >= GRID_ROWS) return null;
  return { x: tileX, y: tileY };
}

export function tileToPixel(
  tileX: number,
  tileY: number,
  transform: Transform
): { px: number; py: number } {
  return {
    px: tileX * TILE_SIZE * transform.scale + transform.offsetX,
    py: tileY * TILE_SIZE * transform.scale + transform.offsetY,
  };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  gridState: Map<string, TileSnapshot>,
  transform: Transform,
  hoverTile: { x: number; y: number } | null
): void {
  const { scale, offsetX, offsetY } = transform;
  const tilePixels = TILE_SIZE * scale;

  // Black fill so the inter-tile gap shows as black grid lines
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      const px = x * tilePixels + offsetX;
      const py = y * tilePixels + offsetY;

      // Viewport culling — skip tiles fully outside the canvas
      if (px + tilePixels < 0 || px > ctx.canvas.width) continue;
      if (py + tilePixels < 0 || py > ctx.canvas.height) continue;

      const tile = gridState.get(`${x},${y}`);
      ctx.fillStyle = tile?.owner_color ?? EMPTY_COLOR;
      // -1 creates a 1px gap between tiles that shows the black background
      ctx.fillRect(px, py, tilePixels - 1, tilePixels - 1);

      if (hoverTile && hoverTile.x === x && hoverTile.y === y) {
        ctx.fillStyle = HOVER_OVERLAY;
        ctx.fillRect(px, py, tilePixels - 1, tilePixels - 1);
      }
    }
  }
}

export function drawSingleTile(
  ctx: CanvasRenderingContext2D,
  tile: TileSnapshot,
  transform: Transform,
  isHovered = false
): void {
  const tilePixels = TILE_SIZE * transform.scale;
  const px = tile.x * tilePixels + transform.offsetX;
  const py = tile.y * tilePixels + transform.offsetY;

  ctx.fillStyle = tile.owner_color ?? EMPTY_COLOR;
  ctx.fillRect(px, py, tilePixels - 1, tilePixels - 1);

  if (isHovered) {
    ctx.fillStyle = HOVER_OVERLAY;
    ctx.fillRect(px, py, tilePixels - 1, tilePixels - 1);
  }
}
