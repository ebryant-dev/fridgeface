/**
 * Rotational symmetry of a shape, measured from its real outline (pure, no DOM).
 *
 * A shape has n-fold symmetry when turning it by 360/n degrees about its centroid gives back the same outline. Fridgeface's
 * pieces are physical magnets, so "the same" is a tolerance, not exact: Edward's vectors are hand drawn. Turned by such an
 * angle, a symmetric piece looks identical, so the guide treats those rotations as equal (see outline.ts, `period`).
 */
export type SymPt = { x: number; y: number };

/** A symmetry counts when the outline turned onto itself deviates by at most this fraction of the shape's size. */
export const SYMMETRY_TOL = 0.015;
/** The symmetry orders tested: 180 (2), 120 (3) and 90 (4) degrees. */
export const SYMMETRY_ORDERS = [2, 3, 4] as const;

function segDist(p: SymPt, a: SymPt, b: SymPt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Distance from a point to a closed outline (its edges). */
function outlineDist(p: SymPt, outline: readonly SymPt[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const d = segDist(p, outline[i], outline[(i + 1) % outline.length]);
    if (d < best) best = d;
  }
  return best;
}

/** The outline with points added along every edge, at most `step` apart (so a polygon's edges are tested, not just its corners). */
function densify(outline: readonly SymPt[], step: number): SymPt[] {
  const out: SymPt[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

const turn = (p: SymPt, c: SymPt, deg: number): SymPt => {
  const t = (deg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
};

/**
 * How far the outline, turned by `deg` about `centre`, lies from itself: the largest distance between the turned outline
 * and the original, both ways (a Hausdorff distance between the two outlines), in the outline's units.
 */
export function rotationDeviation(outline: readonly SymPt[], centre: SymPt, deg: number, step = 1): number {
  const dense = densify(outline, step);
  let worst = 0;
  for (const sign of [1, -1]) {
    for (const q of dense) {
      const d = outlineDist(turn(q, centre, sign * deg), outline);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** The deviation for each tested order (180, 120 and 90 degrees), as a fraction of `size`. */
export function symmetryDeviations(outline: readonly SymPt[], centre: SymPt, size: number): Record<(typeof SYMMETRY_ORDERS)[number], number> {
  const step = Math.max(size / 400, 1e-6);
  const out = {} as Record<(typeof SYMMETRY_ORDERS)[number], number>;
  for (const n of SYMMETRY_ORDERS) out[n] = rotationDeviation(outline, centre, 360 / n, step) / size;
  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The shape's symmetry order: 1 (none), 2 (180 degrees), 3 (120), 4 (90), or a combination (2 and 3 make 6). Every
 * equivalent rotation is a multiple of 360 / order.
 */
export function symmetryOrder(outline: readonly SymPt[], centre: SymPt, size: number, tol = SYMMETRY_TOL): number {
  const dev = symmetryDeviations(outline, centre, size);
  let order = 1;
  for (const n of SYMMETRY_ORDERS) if (dev[n] <= tol) order = (order * n) / gcd(order, n);
  return order;
}
