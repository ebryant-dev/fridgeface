/**
 * Pure angle math for rotating pieces. No DOM. Rotation is free (no snapping, no steps): a magnet turns freely by hand.
 *
 * Conventions (degrees, clockwise-positive, matching SVG rotate()):
 *  - `piece.rotation` is relative to the rest pose (the orientation drawn in the source SVG).
 *  - `Shape.uprightOffsetDeg` is the rest pose's angle away from upright, same sense.
 *  - fromUpright = uprightOffsetDeg + rotation. 0 means the shape is upright.
 *
 * "Upright" per shape: stems and rounds have their long axis vertical; the wedge has its
 * longest edge horizontal, on the side nearest its rest pose (apex down).
 */
const clean = (n: number) => (n === 0 ? 0 : n); // avoid -0

/** Normalise any angle to (-180, 180]. */
export function normalise(deg: number): number {
  let a = ((deg % 360) + 360) % 360; // [0, 360)
  if (a > 180) a -= 360;
  return clean(a);
}

/** The shape's angle from upright (what the screen-reader announcements say). */
export function fromUpright(uprightOffsetDeg: number, rotation: number): number {
  return normalise(uprightOffsetDeg + rotation);
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
