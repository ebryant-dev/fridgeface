import { normalise } from './rotation';

/**
 * Selection geometry and selection-aware restacking. Pure, no DOM.
 *
 * A **selection** is temporary (see CONTEXT.md): it is never saved, and there are no lasting groups. A selection of several
 * pieces moves and rotates as ONE rigid unit about its common centre, and restacks past the next piece it actually overlaps.
 *
 * Geometry: every Fridgeface shape is convex, so each piece is represented by its convex outline (a hull of the source
 * geometry, in source units, relative to the shape's area centroid, at the rest pose). Intersection is the separating axis
 * test on those outlines. Board units and rotation conventions match the piece transform: centroid at (x, y), rotation in
 * degrees clockwise about the centroid (SVG `rotate()`).
 */

export type Pt = { x: number; y: number };
export interface Box { x: number; y: number; w: number; h: number }
export interface Placement { x: number; y: number; rotation: number }
export interface PlacedPiece extends Placement { id: string; shapeId: string }
/** The convex outline of a shape, centroid-relative, at the rest pose. */
export type HullOf = (shapeId: string) => readonly Pt[] | undefined;

const EPS = 1e-9;

/** Convex hull (Andrew's monotone chain), counter-clockwise in y-up terms; collinear points dropped. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rotate `p` by `deg` (clockwise on screen, SVG convention) about `c`. */
export function rotateAbout(p: Pt, c: Pt, deg: number): Pt {
  const th = (deg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** A centroid-relative outline placed on the board at a piece's position and rotation. */
export function placeOutline(hull: readonly Pt[], p: Placement): Pt[] {
  const th = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return hull.map((q) => ({ x: p.x + q.x * cos - q.y * sin, y: p.y + q.x * sin + q.y * cos }));
}

export function boundsOf(pts: readonly Pt[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boxPolygon(b: Box): Pt[] {
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
}

/** Normalise a box drawn from any corner to any other (negative width/height allowed in the input). */
export function boxFromCorners(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w + EPS && b.x < a.x + a.w + EPS && a.y < b.y + b.h + EPS && b.y < a.y + a.h + EPS;
}

/** Does any edge normal of `poly` separate the two point sets? */
function separatedByAxesOf(poly: readonly Pt[], a: readonly Pt[], b: readonly Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const nx = q.y - p.y, ny = p.x - q.x;
    if (Math.abs(nx) < EPS && Math.abs(ny) < EPS) continue;
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const v of a) {
      const d = v.x * nx + v.y * ny;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const v of b) {
      const d = v.x * nx + v.y * ny;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    const tol = EPS * Math.hypot(nx, ny);
    // Touching edges are NOT an overlap: there has to be area in common.
    if (maxA <= minB + tol || maxB <= minA + tol) return true;
  }
  return false;
}

/**
 * Do two convex polygons share some area? Separating axis test (only edge normals are needed for convex polygons).
 * Polygons that merely touch along an edge or at a point do not overlap.
 */
export function convexIntersect(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (!boxesOverlap(boundsOf(a), boundsOf(b))) return false;
  return !separatedByAxesOf(a, a, b) && !separatedByAxesOf(b, a, b);
}

/** Ids of the pieces whose real outline intersects an axis-aligned board box (not just their bounding boxes), in stacking order. */
export function piecesInBox(pieces: readonly PlacedPiece[], hullOf: HullOf, box: Box): string[] {
  if (!(box.w > 0 || box.h > 0)) return [];
  // A zero-thickness box still has to be a polygon for SAT: give it a hair of thickness.
  const b = { x: box.x, y: box.y, w: Math.max(box.w, 1e-6), h: Math.max(box.h, 1e-6) };
  const poly = boxPolygon(b);
  const out: string[] = [];
  for (const p of pieces) {
    const h = hullOf(p.shapeId);
    if (h && convexIntersect(placeOutline(h, p), poly)) out.push(p.id);
  }
  return out;
}

/** Do two placed pieces overlap (share area)? */
export function piecesOverlap(a: PlacedPiece, b: PlacedPiece, hullOf: HullOf): boolean {
  const ha = hullOf(a.shapeId), hb = hullOf(b.shapeId);
  return !!ha && !!hb && convexIntersect(placeOutline(ha, a), placeOutline(hb, b));
}

/**
 * The selection's frame: the bounds of all its outlines measured in a frame rotated by `angleDeg` (the selection box turns
 * with the selection when it is rotated as a unit), and that box's centre on the board. With angle 0 the box is the
 * axis-aligned bounds. The box is invariant under rigid motion of the whole selection when the angle turns with it.
 */
export function selectionFrame(pieces: readonly PlacedPiece[], hullOf: HullOf, angleDeg = 0): { box: Box; centre: Pt } | null {
  const pts: Pt[] = [];
  const o = { x: 0, y: 0 };
  for (const p of pieces) {
    const h = hullOf(p.shapeId);
    if (!h) continue;
    for (const q of placeOutline(h, p)) pts.push(angleDeg ? rotateAbout(q, o, -angleDeg) : q);
  }
  if (!pts.length) return null;
  const box = boundsOf(pts);
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return { box, centre: angleDeg ? rotateAbout(c, o, angleDeg) : c };
}

/**
 * Rotate pieces as ONE rigid unit by `deltaDeg` about `centre`: every position orbits the centre and every rotation adds the
 * same angle, so distances and relative angles between the pieces are preserved exactly.
 */
export function rotateRigid<T extends Placement>(pieces: readonly T[], centre: Pt, deltaDeg: number): T[] {
  return pieces.map((p) => {
    const q = rotateAbout(p, centre, deltaDeg);
    return { ...p, x: q.x, y: q.y, rotation: normalise(p.rotation + deltaDeg) };
  });
}

/** Translate pieces by (dx, dy). */
export function translateAll<T extends Placement>(pieces: readonly T[], dx: number, dy: number): T[] {
  return pieces.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
}

/** Every piece on the board, in stacking order. */
export function selectAll(pieces: readonly { id: string }[]): string[] {
  return pieces.map((p) => p.id);
}

/** Add `id` to the selection, or remove it if it is already there. The order of the rest is kept. */
export function toggleInSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
}

/**
 * Bring forward, overlap-aware: move the selection up past the NEXT unselected piece above it that it actually overlaps.
 *
 * `order` is the stacking order (bottom first). The target is the lowest unselected piece that sits above some selected piece
 * it overlaps. Every selected piece below the target moves to directly above it, keeping the selection's internal order;
 * selected pieces already above the target stay where they are, and unselected pieces keep their relative order. Pieces in
 * between that the selection does not overlap are passed without visible change. Returns the new order, or null when nothing
 * above overlaps (a no-op).
 */
export function bringForwardOverlapping(order: readonly string[], selected: ReadonlySet<string>, overlaps: (a: string, b: string) => boolean): string[] | null {
  let target = -1;
  const below: string[] = []; // selected pieces seen so far, from the bottom
  for (let j = 0; j < order.length; j++) {
    const id = order[j];
    if (selected.has(id)) {
      below.push(id);
      continue;
    }
    if (below.length && below.some((s) => overlaps(s, id))) {
      target = j;
      break;
    }
  }
  if (target < 0) return null;
  const moving = new Set(below);
  const out: string[] = [];
  for (let j = 0; j < order.length; j++) {
    const id = order[j];
    if (moving.has(id)) continue;
    out.push(id);
    if (j === target) out.push(...below);
  }
  return out;
}

/** Send backward, overlap-aware: the mirror image of bringForwardOverlapping. Returns null when nothing below overlaps. */
export function sendBackwardOverlapping(order: readonly string[], selected: ReadonlySet<string>, overlaps: (a: string, b: string) => boolean): string[] | null {
  const r = bringForwardOverlapping([...order].reverse(), selected, overlaps);
  return r ? r.reverse() : null;
}
