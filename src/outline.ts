import { normalise } from './rotation';
import { rotatedBounds, type Rect } from './camera';

/**
 * Outlines: the guide's dotted targets (see CONTEXT.md). Pure, no DOM.
 *
 * An **outline** shows where one piece of a suggestion belongs, at its exact board position and rotation. ONLY while the
 * guide is running, a piece of the outline's shape that is released (a drag ends, a turn ends) close to an active outline
 * clicks exactly into it. Outside the guide nothing ever snaps: there is no snapping code path that does not start from a
 * running guide's active outlines.
 *
 * An outline counts as **filled** when a piece of its shape sits exactly on it (the click-in puts it there). This is read
 * from the board every time, so deleting, moving, undoing or redoing keeps the guide consistent with what is on the board.
 */

export interface Outline {
  shapeId: string;
  x: number;
  y: number;
  rotation: number;
  /**
   * The outline's shape's symmetry period, degrees (360 / its symmetry order; absent: 360, no symmetry). Rotations equal
   * modulo it look identical, so a piece at any of them fits the outline (an oval turned 180 degrees is the same oval).
   * Set from the shape by `outlinesAt` and `anchorWord`; pieces never carry it.
   */
  period?: number;
}
export interface OutlinePiece extends Outline {
  id: string;
}
/** A shape's size for the click-in tolerance: the longer side of its upright bounds, board units. */
export type SizeOf = (shapeId: string) => number;

/** A piece released within this fraction of its shape's size (centroid to centroid) is close enough to click in. */
export const CLICK_POS_FRACTION = 0.18;
/** ...and within this many degrees of the outline's rotation. */
export const CLICK_ANGLE_DEG = 12;
/** "Sits exactly on it": the click-in is exact; these only absorb rounding (auto-save keeps 0.1 units and 0.01 degrees). */
export const FILL_POS_EPS = 0.15;
export const FILL_ANGLE_EPS = 0.05;

export interface Tolerance {
  pos: number;
  angle: number;
}
export const CLICK_TOLERANCE: Readonly<Tolerance> = Object.freeze({ pos: CLICK_POS_FRACTION, angle: CLICK_ANGLE_DEG });

/** The smaller angle between two rotations, degrees in [0, 180] (wraps: 179 and -179 are 2 apart). */
export function angleGap(a: number, b: number): number {
  return Math.abs(normalise(a - b));
}

/** A shape's symmetry period from its symmetry order (1 or missing: 360, none). */
export const periodOf = (symmetry: number | undefined): number => (symmetry && symmetry > 1 ? 360 / symmetry : 360);

/** The outline's rotation equivalent to `rotation`'s that is nearest it (signed: `rotation` + this lands on one), degrees. */
function offsetTo(o: Outline, rotation: number): number {
  const period = o.period ?? 360;
  let d = (((o.rotation - rotation) % period) + period) % period; // [0, period)
  if (d > period / 2) d -= period;
  return d;
}

/** The smaller angle between a piece's rotation and the outline's, modulo the outline's symmetry period, degrees. */
export function outlineAngleGap(o: Outline, rotation: number): number {
  return Math.abs(offsetTo(o, rotation));
}

/**
 * Where a piece at `rotation` settles on the outline: the outline's rotation, or the equivalent one (by its symmetry)
 * NEAREST the piece's own, so a symmetric piece never spins a half turn to click in. Normalised and rounded like the wire
 * format (0.01 degrees), so a saved board still sits exactly on it.
 */
export function settleRotation(o: Outline, rotation: number): number {
  return Math.round(normalise(rotation + offsetTo(o, rotation)) * 100) / 100 || 0;
}

/** The indices of the outlines that are not filled. */
export function activeIndices(filled: readonly (string | null)[]): number[] {
  const out: number[] = [];
  filled.forEach((f, i) => {
    if (!f) out.push(i);
  });
  return out;
}

/** Does the piece sit exactly on the outline (same shape, same place, same rotation, modulo the shape's symmetry)? */
export function sitsOn(o: Outline, p: Outline): boolean {
  return o.shapeId === p.shapeId && Math.hypot(o.x - p.x, o.y - p.y) <= FILL_POS_EPS && outlineAngleGap(o, p.rotation) <= FILL_ANGLE_EPS;
}

/**
 * How a piece relates to an outline: 'fit' (right shape, close enough in position AND angle: it would click in), 'near'
 * (right shape and close enough in position, but needs turning), 'far' (wrong shape, or too far away). Angles are compared
 * modulo the outline's symmetry period: an oval half a turn from its outline fits it.
 */
export function outlineMatch(o: Outline, p: Outline, sizeOf: SizeOf, tol: Tolerance = CLICK_TOLERANCE): 'fit' | 'near' | 'far' {
  if (o.shapeId !== p.shapeId) return 'far';
  if (Math.hypot(o.x - p.x, o.y - p.y) > tol.pos * sizeOf(o.shapeId)) return 'far';
  return outlineAngleGap(o, p.rotation) <= tol.angle ? 'fit' : 'near';
}

/**
 * Which piece fills each outline (exactly on it), or null. Each piece fills at most one outline, and each outline is filled
 * by at most one piece (the topmost one sitting on it wins, as it is the one the visitor sees).
 */
export function filledBy(outlines: readonly Outline[], pieces: readonly OutlinePiece[]): (string | null)[] {
  const used = new Set<string>();
  return outlines.map((o) => {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (!used.has(p.id) && sitsOn(o, p)) {
        used.add(p.id);
        return p.id;
      }
    }
    return null;
  });
}

/**
 * The outline a released piece clicks into: among the `active` outline indices that are not filled, those of the piece's
 * shape within tolerance in position AND angle; the nearest wins. Null when there is none (the piece stays where it was
 * dropped). No active outlines (the guide is not running) means null, always.
 */
export function clickTarget(
  outlines: readonly Outline[], active: readonly number[], filled: readonly (string | null)[], p: Outline, sizeOf: SizeOf, tol: Tolerance = CLICK_TOLERANCE,
): number | null {
  let best: { i: number; d: number } | null = null;
  for (const i of active) {
    const o = outlines[i];
    if (!o || filled[i] || outlineMatch(o, p, sizeOf, tol) !== 'fit') continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (!best || d < best.d) best = { i, d };
  }
  return best ? best.i : null;
}

/** Is some piece close to an active, unfilled outline of its shape but at the wrong angle (it needs turning)? Returns its id. */
export function needsTurning(
  outlines: readonly Outline[], active: readonly number[], filled: readonly (string | null)[], pieces: readonly OutlinePiece[], sizeOf: SizeOf, tol: Tolerance = CLICK_TOLERANCE,
): string | null {
  const filling = new Set(filled.filter((id): id is string => !!id));
  for (let j = pieces.length - 1; j >= 0; j--) {
    const p = pieces[j];
    if (filling.has(p.id)) continue;
    for (const i of active) if (!filled[i] && outlineMatch(outlines[i], p, sizeOf, tol) === 'near') return p.id;
  }
  return null;
}

export interface ClickResult {
  /** The pieces that clicked in, with their exact new placements. */
  placements: { id: string; x: number; y: number; rotation: number; outline: number }[];
  /** The new stacking order (bottom first), or null when it does not change. */
  order: string[] | null;
}

/**
 * Click released pieces into the active outlines they are close to, then fix the stacking order so the filled pieces sit in
 * the suggestion's own order (see `stackFix`). The caller applies both as part of the SAME undo step as the release.
 * Returns null when nothing clicks in. Pieces are taken in `released` order; each outline accepts one piece.
 */
export function clickIn(
  outlines: readonly Outline[], active: readonly number[], pieces: readonly OutlinePiece[], released: readonly string[], sizeOf: SizeOf, tol: Tolerance = CLICK_TOLERANCE,
): ClickResult | null {
  if (!active.length || !released.length) return null;
  const filled = filledBy(outlines, pieces);
  const placements: ClickResult['placements'] = [];
  const byId = new Map(pieces.map((p) => [p.id, p]));
  for (const id of released) {
    const p = byId.get(id);
    if (!p || filled.includes(id)) continue;
    const i = clickTarget(outlines, active, filled, p, sizeOf, tol);
    if (i === null) continue;
    const o = outlines[i];
    filled[i] = id;
    // Exactly the outline's place, at its rotation or the symmetric equivalent nearest the piece's (no half-turn spin).
    placements.push({ id, x: o.x, y: o.y, rotation: settleRotation(o, p.rotation), outline: i });
  }
  if (!placements.length) return null;
  const order = stackFix(pieces.map((p) => p.id), filled);
  const same = order.every((id, i) => id === pieces[i].id);
  return { placements, order: same ? null : order };
}

/**
 * Stacking order with the filled pieces in the suggestion's order: the slots the filled pieces occupy in `order` stay
 * where they are, and are refilled by those pieces sorted by their outline's index (the suggestion lists its pieces bottom
 * first). Every other piece keeps its place. So negative pieces end up above the positive ones they cut, exactly as built.
 */
export function stackFix(order: readonly string[], filled: readonly (string | null)[]): string[] {
  const rank = new Map<string, number>();
  filled.forEach((id, i) => {
    if (id) rank.set(id, i);
  });
  const slots: number[] = [];
  order.forEach((id, i) => {
    if (rank.has(id)) slots.push(i);
  });
  const sorted = slots.map((i) => order[i]).sort((a, b) => rank.get(a)! - rank.get(b)!);
  const out = [...order];
  slots.forEach((slot, k) => (out[slot] = sorted[k]));
  return out;
}

export type ShapeFrame = { bbox: Rect; centroid: { x: number; y: number }; /** Rotational symmetry order (shapes.ts); absent: none. */ symmetry?: number };

/** An outline for a piece of a suggestion, carrying its shape's symmetry period (when it has one). */
export function outlineOf(shapeId: string, x: number, y: number, rotation: number, shapeOf: (id: string) => ShapeFrame | undefined): Outline {
  const period = periodOf(shapeOf(shapeId)?.symmetry);
  return period < 360 ? { shapeId, x, y, rotation, period } : { shapeId, x, y, rotation };
}

/**
 * A suggestion's pieces as outlines on the board, moved rigidly so the centre of their rotated bounds is at `centre` (to
 * within 0.05 units: the move is rounded to 0.1). Rounded like the wire format (0.1 units, 0.01 degrees), so a saved and
 * restored board still sits exactly on them.
 */
export function outlinesAt(pieces: readonly Outline[], shapeOf: (id: string) => ShapeFrame | undefined, centre: { x: number; y: number }): Outline[] {
  const b = rotatedBounds(pieces, shapeOf);
  if (!b) return [];
  const r1 = (n: number) => Math.round(n * 10) / 10 || 0;
  // The move itself is a whole number of 0.1 units, so the pieces' arrangement is kept exactly (not just to rounding).
  const dx = r1(centre.x - (b.x + b.w / 2)), dy = r1(centre.y - (b.y + b.h / 2));
  return pieces.map((p) => outlineOf(p.shapeId, r1(p.x + dx), r1(p.y + dy), Math.round(normalise(p.rotation) * 100) / 100 || 0, shapeOf));
}
