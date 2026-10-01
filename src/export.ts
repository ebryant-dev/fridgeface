import { rotatedBounds, type Point, type Rect } from './camera';

/**
 * The ONE renderer for exported images (PNG and SVG both come from here). Chunk 7 adds texture and
 * shadows in this file only. Pure string output, no DOM, no <filter> elements, no external references.
 *
 * Units: 1 board unit = 1 SVG user unit = 1 px at 1x.
 */
export const EXPORT_BACKGROUND = '#bdbdbd'; // matches the on-screen board for now
export const EXPORT_MIN_MARGIN = 24;
export const EXPORT_MARGIN_RATIO = 0.06;
export const EMPTY_SIZE = 400;

export interface ExportShape {
  id: string;
  fill: string;
  geometry: { kind: 'polygon'; points: string } | { kind: 'path'; d: string };
  centroid: Point;
  bbox: Rect;
}
export interface ExportPiece {
  shapeId: string;
  x: number;
  y: number;
  rotation: number;
}
export interface RenderedExport {
  svg: string;
  width: number;
  height: number;
}

const f = (n: number) => String(Math.round(n * 100) / 100);

function geometry(s: ExportShape): string {
  return s.geometry.kind === 'polygon'
    ? `<polygon points="${s.geometry.points}" fill="${s.fill}"/>`
    : `<path d="${s.geometry.d}" fill="${s.fill}"/>`;
}

/** Same placement as the board: centroid at (x, y), rotation about the centroid. */
function transform(p: ExportPiece, s: ExportShape): string {
  return `translate(${f(p.x - s.centroid.x)} ${f(p.y - s.centroid.y)}) rotate(${f(p.rotation)} ${f(s.centroid.x)} ${f(s.centroid.y)})`;
}

/** Render pieces (bottom first) to a standalone SVG framed to their rotated bounds plus a margin. */
export function renderCompositionSvg(pieces: readonly ExportPiece[], shapeOf: (id: string) => ExportShape | undefined): RenderedExport {
  const known = pieces.filter((p) => shapeOf(p.shapeId));
  const b = rotatedBounds(known, shapeOf);
  let x: number, y: number, w: number, h: number;
  if (b) {
    const margin = Math.max(EXPORT_MIN_MARGIN, EXPORT_MARGIN_RATIO * Math.max(b.w, b.h));
    x = b.x - margin; y = b.y - margin; w = b.w + 2 * margin; h = b.h + 2 * margin;
  } else {
    x = 0; y = 0; w = EMPTY_SIZE; h = EMPTY_SIZE;
  }
  const body = known.map((p) => `<g transform="${transform(p, shapeOf(p.shapeId)!)}">${geometry(shapeOf(p.shapeId)!)}</g>`).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">` +
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${EXPORT_BACKGROUND}"/>` +
    body +
    `</svg>`;
  return { svg, width: w, height: h };
}

/** Pixel size for a PNG: `scale` x natural size, longest side capped. */
export function pngSize(width: number, height: number, scale = 2, maxSide = 4096): { width: number; height: number } {
  const s = Math.min(scale, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `fridgeface-YYYYMMDD-HHMM.<ext>` in local time. */
export function exportFilename(ext: 'png' | 'svg', d = new Date()): string {
  return `fridgeface-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}
