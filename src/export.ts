import { rotatedBounds, type Point, type Rect } from './camera';
import { REST_SHADOW, SHADOW_BOARD_SCALE, staticShadowMarkup, subdivide } from './shadow';
import { TEXTURE_BASE } from './texture';

/**
 * The ONE renderer for exported images (PNG and SVG both come from here): the fridge texture (an
 * embedded data-URL pattern in board space, exactly as on screen) and the same filter-free shadows.
 * Pure string output, no DOM, no <filter> elements, no external references.
 *
 * Units: 1 board unit = 1 SVG user unit = 1 px at 1x.
 */
export const EXPORT_BACKGROUND = `rgb(${TEXTURE_BASE.join(',')})`; // under the texture (and the whole board if none)
/**
 * Board units per shadow px in exports: the shadow's board-space size at the reference view (the default desktop zoom, 0.4 px
 * per unit), the same as on screen there. Exports are not zoom-dependent, so they always use it.
 */
export const EXPORT_SHADOW_SCALE = SHADOW_BOARD_SCALE;
/** The resting shadow, subdivided: exports are viewed large, where four steps would band. */
const EXPORT_SHADOW = subdivide(REST_SHADOW);
export const EXPORT_MIN_MARGIN = 48; // room for the shadow's soft edge (~41 units at EXPORT_SHADOW_SCALE)
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
/** A seamless texture tile: `href` is a data URL; one tile covers `units` x `units` board units, anchored at the board origin. */
export interface ExportTexture {
  href: string;
  units: number;
}
export interface RenderedExport {
  svg: string;
  width: number;
  height: number;
}

const f = (n: number) => String(Math.round(n * 100) / 100);

/** The geometry element with an `{a}` placeholder for attributes. */
function geometryTemplate(s: ExportShape): string {
  return s.geometry.kind === 'polygon' ? `<polygon points="${s.geometry.points}" {a}/>` : `<path d="${s.geometry.d}" {a}/>`;
}

/** Same placement as the board: centroid at (x, y), rotation about the centroid. */
function rotation(p: ExportPiece, s: ExportShape): string {
  return `rotate(${f(p.rotation)}) translate(${f(-s.centroid.x)} ${f(-s.centroid.y)})`;
}

/** One piece: [shadow, shape]. The shadow offset is outside the rotation, so it always falls down-right. */
function pieceMarkup(p: ExportPiece, s: ExportShape): string {
  const geom = geometryTemplate(s);
  const rot = rotation(p, s);
  return (
    `<g transform="translate(${f(p.x)} ${f(p.y)})">` +
    staticShadowMarkup(`<g transform="${rot}">${geom}</g>`, EXPORT_SHADOW_SCALE, EXPORT_SHADOW) +
    `<g transform="${rot}">${geom.replace('{a}', `fill="${s.fill}"`)}</g>` +
    `</g>`
  );
}

/** Render pieces (bottom first) to a standalone SVG framed to their rotated bounds plus a margin. */
export function renderCompositionSvg(
  pieces: readonly ExportPiece[],
  shapeOf: (id: string) => ExportShape | undefined,
  texture?: ExportTexture,
  /** false leaves out the solid base colour (the PNG path lays the texture on its canvas first). */
  opaqueBase = true,
): RenderedExport {
  const known = pieces.filter((p) => shapeOf(p.shapeId));
  const b = rotatedBounds(known, shapeOf);
  let x: number, y: number, w: number, h: number;
  if (b) {
    const margin = Math.max(EXPORT_MIN_MARGIN, EXPORT_MARGIN_RATIO * Math.max(b.w, b.h));
    x = b.x - margin; y = b.y - margin; w = b.w + 2 * margin; h = b.h + 2 * margin;
  } else {
    x = 0; y = 0; w = EMPTY_SIZE; h = EMPTY_SIZE;
  }
  const body = known.map((p) => pieceMarkup(p, shapeOf(p.shapeId)!)).join('');
  const rect = (fill: string) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`;
  const tex = texture
    ? `<defs><pattern id="ff-tex" patternUnits="userSpaceOnUse" x="0" y="0" width="${f(texture.units)}" height="${f(texture.units)}">` +
      `<image href="${texture.href}" x="0" y="0" width="${f(texture.units)}" height="${f(texture.units)}" preserveAspectRatio="none"/></pattern></defs>` +
      rect('url(#ff-tex)')
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}" height="${f(h)}" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">` +
    (opaqueBase || !texture ? rect(EXPORT_BACKGROUND) : '') +
    tex +
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
