/**
 * Pure angle math for rotating pieces. No DOM.
 *
 * Conventions (degrees, clockwise-positive, matching SVG rotate()):
 *  - `piece.rotation` is relative to the rest pose (the orientation drawn in the source SVG).
 *  - `Shape.uprightOffsetDeg` is the rest pose's angle away from upright, same sense.
 *  - fromUpright = uprightOffsetDeg + rotation. 0 means the shape is upright.
 *
 * "Upright" per shape: stems and rounds have their long axis vertical; the wedge has its
 * longest edge horizontal, on the side nearest its rest pose (apex down).
 */
export const SNAP_STEP = 15;
const EPS = 1e-6;

const clean = (n: number) => (n === 0 ? 0 : n); // avoid -0

/** Normalise any angle to (-180, 180]. */
export function normalise(deg: number): number {
  let a = ((deg % 360) + 360) % 360; // [0, 360)
  if (a > 180) a -= 360;
  return clean(a);
}

export function fromUpright(uprightOffsetDeg: number, rotation: number): number {
  return normalise(uprightOffsetDeg + rotation);
}

/** The piece rotation that puts the shape at the given angle from upright. */
export function rotationFor(uprightOffsetDeg: number, fromUprightDeg: number): number {
  return normalise(fromUprightDeg - uprightOffsetDeg);
}

export function isOnStep(fromUprightDeg: number): boolean {
  const n = normalise(fromUprightDeg);
  return Math.abs(n - Math.round(n / SNAP_STEP) * SNAP_STEP) < EPS;
}

/** Snap to the nearest step toward upright (truncate toward 0). On-step angles are unchanged. */
export function snapTowardUpright(fromUprightDeg: number): number {
  const n = normalise(fromUprightDeg);
  if (isOnStep(n)) return normalise(Math.round(n / SNAP_STEP) * SNAP_STEP);
  return clean(Math.trunc(n / SNAP_STEP) * SNAP_STEP);
}

/** Snap to the nearest multiple of the step (used while dragging). */
export function snapNearest(fromUprightDeg: number): number {
  return normalise(Math.round(normalise(fromUprightDeg) / SNAP_STEP) * SNAP_STEP);
}

/**
 * One rotate step. Off a step: snap toward upright first (whichever way was asked).
 * On a step: move to the next (dir = 1, clockwise) or previous (dir = -1) multiple.
 */
export function stepFromUpright(fromUprightDeg: number, dir: 1 | -1): number {
  const n = normalise(fromUprightDeg);
  if (!isOnStep(n)) return snapTowardUpright(n);
  return normalise(Math.round(n / SNAP_STEP) * SNAP_STEP + dir * SNAP_STEP);
}

/** Bounds of `pts` rotated by -offDeg about `c`, relative to `c`. */
export function uprightBounds(pts: readonly { x: number; y: number }[], c: { x: number; y: number }, offDeg: number) {
  const th = (-offDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const lx = p.x - c.x, ly = p.y - c.y;
    const x = lx * cos - ly * sin, y = lx * sin + ly * cos;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
