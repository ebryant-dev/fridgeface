/**
 * Camera model: a pure view transform over the unbounded board. No DOM.
 *
 * "Screen" units are whatever the host draws in (the component uses SVG viewBox units, i.e.
 * CSS px / k). A board point b appears at screen = b * zoom + (x, y). zoom 1 is the default view.
 * Zoom is a VIEW change only: it never touches piece data.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_CAMERA: Readonly<Camera> = { x: 0, y: 0, zoom: 1 };

/** Phones, free play: this many black ovals (positive rounds) fit side to side across the visible board's shorter side... */
export const PHONE_OVALS_ACROSS = 4;
/** ...with a little air, so four fit with a sliver to spare (the row is 97% of that side). */
export const PHONE_COMFORT_MARGIN = 0.97;

/**
 * The comfortable zoom on phones (the compact layout, either orientation): PHONE_OVALS_ACROSS black ovals, `ovalWidth` board
 * units wide each, fit side by side across the shorter side of `visible`, the board area actually in sight (below the top
 * docks in portrait; right of the vertical tray in landscape: the host passes that area's size in screen units). Pure.
 */
export function phoneComfortZoom(visible: { width: number; height: number }, ovalWidth: number): number {
  const side = Math.min(visible.width, visible.height);
  return side > 0 && ovalWidth > 0 ? (PHONE_COMFORT_MARGIN * side) / (PHONE_OVALS_ACROSS * ovalWidth) : DEFAULT_CAMERA.zoom;
}

/** Phones, the guide's c (steps 1 to 3): the black oval's upright width is this share of the visible board's shorter side. */
export const C_OVAL_SHARE = 0.45;

/**
 * The zoom that frames the guide's c on phones: the black oval's upright width, `ovalWidth` board units, is C_OVAL_SHARE of the
 * shorter side of `visible` (the same visible-board area as `phoneComfortZoom`: about 2.2 ovals across), or less where the
 * whole c (`c`, its tight bounds in board units, oval and wedge) would not then fit `visible` with `pad` of air on every side
 * (a short landscape board). Pure; 1 when a size is missing.
 */
export function cFrameZoom(visible: { width: number; height: number }, ovalWidth: number, c: { w: number; h: number }, pad: number): number {
  const side = Math.min(visible.width, visible.height);
  if (!(side > 0) || !(ovalWidth > 0)) return DEFAULT_CAMERA.zoom;
  const want = (C_OVAL_SHARE * side) / ovalWidth;
  const zw = c.w > 0 ? Math.max(1, visible.width - 2 * pad) / c.w : Infinity;
  const zh = c.h > 0 ? Math.max(1, visible.height - 2 * pad) / c.h : Infinity;
  return Math.min(want, zw, zh);
}

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  return Math.min(max, Math.max(min, zoom));
}

export function screenToBoard(c: Camera, p: Point): Point {
  return { x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom };
}

export function boardToScreen(c: Camera, p: Point): Point {
  return { x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y };
}

/** Zoom by `factor` (clamped), keeping the board point under screen point `p` fixed. */
export function zoomAt(c: Camera, p: Point, factor: number): Camera {
  const zoom = clampZoom(c.zoom * factor);
  const b = screenToBoard(c, p);
  return { x: p.x - b.x * zoom, y: p.y - b.y * zoom, zoom };
}

/** Shift the view by (dx, dy) screen units (content follows the pointer). */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { x: c.x + dx, y: c.y + dy, zoom: c.zoom };
}

/**
 * Camera that frames `bounds` (board units) inside a viewport of `viewport` screen units,
 * leaving `margin` screen units on every side. The result is centred and the zoom is clamped
 * to [MIN_ZOOM, maxZoom] (so a lone small piece is not blown up absurdly).
 */
export function fitTo(
  bounds: Rect,
  viewport: { width: number; height: number },
  margin: number,
  maxZoom = MAX_ZOOM,
): Camera {
  const availW = Math.max(1, viewport.width - 2 * margin);
  const availH = Math.max(1, viewport.height - 2 * margin);
  const zw = bounds.w > 0 ? availW / bounds.w : Infinity;
  const zh = bounds.h > 0 ? availH / bounds.h : Infinity;
  const zoom = clampZoom(Math.min(zw, zh), MIN_ZOOM, maxZoom);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { x: viewport.width / 2 - cx * zoom, y: viewport.height / 2 - cy * zoom, zoom };
}

interface ShapeFrame {
  bbox: Rect;
  centroid: Point;
}
interface Placed {
  shapeId: string;
  x: number;
  y: number;
  rotation: number;
}

/**
 * Board-space bounds of every piece after rotation (rotated bbox corners, a slight overestimate for rounds).
 * Matches the piece transform: centroid at (x, y), rotation about the centroid. Null when empty.
 */
export function rotatedBounds(pieces: readonly Placed[], shapeOf: (id: string) => ShapeFrame | undefined): Rect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pieces) {
    const s = shapeOf(p.shapeId);
    if (!s) continue;
    const th = (p.rotation * Math.PI) / 180;
    const cos = Math.cos(th), sin = Math.sin(th);
    for (const [cx, cy] of [
      [s.bbox.x, s.bbox.y],
      [s.bbox.x + s.bbox.w, s.bbox.y],
      [s.bbox.x, s.bbox.y + s.bbox.h],
      [s.bbox.x + s.bbox.w, s.bbox.y + s.bbox.h],
    ]) {
      const lx = cx - s.centroid.x, ly = cy - s.centroid.y;
      const x = p.x + lx * cos - ly * sin;
      const y = p.y + lx * sin + ly * cos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
