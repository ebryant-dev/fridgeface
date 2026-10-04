import { describe, expect, it } from 'vitest';
import wedgeSvg from './shapes/wedge.svg?raw';
import positiveRoundSvg from './shapes/positive-round.svg?raw';
import {
  boxFromCorners, boxPolygon, bringForwardOverlapping, convexHull, convexIntersect, piecesInBox, piecesOverlap, placeOutline,
  rotateRigid, selectAll, selectionFrame, sendBackwardOverlapping, toggleInSelection, translateAll,
  type PlacedPiece, type Pt,
} from './selection';

// ---- real shape outlines, read from the source SVGs without a DOM -------------------------------------------------

function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

const rel = (pts: Pt[]) => {
  const c = centroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
};

/** The wedge polygon, centroid-relative. */
function wedgeHull(): Pt[] {
  const n = /points="([^"]+)"/.exec(wedgeSvg)![1].trim().split(/[\s,]+/).map(Number);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
  pts.pop(); // closing duplicate
  return rel(convexHull(pts));
}

/** The positive round: its path is M + relative cubics (c) + h0 + Z. Sampled densely, centroid-relative. */
function roundHull(): Pt[] {
  const d = /\sd="([^"]+)"/.exec(positiveRoundSvg)![1];
  const nums = (s: string) => s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)!.map(Number);
  const m = /^M([^c]+)c(.+?)h/.exec(d)!;
  let [x, y] = nums(m[1]);
  const c = nums(m[2]);
  const pts: Pt[] = [];
  for (let i = 0; i + 5 < c.length; i += 6) {
    const p0 = { x, y }, p1 = { x: x + c[i], y: y + c[i + 1] }, p2 = { x: x + c[i + 2], y: y + c[i + 3] }, p3 = { x: x + c[i + 4], y: y + c[i + 5] };
    for (let k = 0; k < 64; k++) {
      const t = k / 64, u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
    x = p3.x;
    y = p3.y;
  }
  return rel(convexHull(pts));
}

const HULLS: Record<string, Pt[]> = {
  wedge: wedgeHull(),
  round: roundHull(),
  sq: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
};
const hullOf = (id: string) => HULLS[id];
const piece = (id: string, shapeId: string, x: number, y: number, rotation = 0): PlacedPiece => ({ id, shapeId, x, y, rotation });

// ---- an independent, exact oracle for convex polygon overlap -------------------------------------------------------

function strictlyInside(p: Pt, poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cr) < 1e-9) return false;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function oracle(A: Pt[], B: Pt[]): boolean {
  if (A.some((p) => strictlyInside(p, B)) || B.some((p) => strictlyInside(p, A))) return true;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (properCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return false;
}

/** A small deterministic PRNG so the property checks are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('convex geometry', () => {
  it('builds a convex hull and drops interior and collinear points', () => {
    const h = convexHull([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }]);
    expect(h).toHaveLength(4);
    expect(h).toEqual(expect.arrayContaining([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]));
  });

  it('piece vs piece: overlapping, separated, touching and contained', () => {
    const sq = HULLS.sq;
    expect(convexIntersect(placeOutline(sq, { x: 0, y: 0, rotation: 0 }), placeOutline(sq, { x: 15, y: 5, rotation: 0 }))).toBe(true);
    expect(convexIntersect(placeOutline(sq, { x: 0, y: 0, rotation: 0 }), placeOutline(sq, { x: 25, y: 0, rotation: 0 }))).toBe(false);
    expect(convexIntersect(placeOutline(sq, { x: 0, y: 0, rotation: 0 }), placeOutline(sq, { x: 20, y: 0, rotation: 0 })), 'edges touching is not an overlap').toBe(false);
    expect(convexIntersect(placeOutline(sq, { x: 0, y: 0, rotation: 0 }), placeOutline([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 1 }], { x: 2, y: 2, rotation: 0 })), 'contained').toBe(true);
    // Two squares whose bounding boxes overlap but whose shapes do not: one turned 45 degrees, its corner short of the other's corner.
    const a = placeOutline(sq, { x: 0, y: 0, rotation: 0 });
    const b = placeOutline(sq, { x: 25, y: 25, rotation: 45 });
    expect(convexIntersect(a, b)).toBe(false);
  });

  it('agrees with an exact oracle for real, rotated shapes (wedge, round) in random placements', () => {
    const r = rng(7);
    let hits = 0, misses = 0;
    for (let i = 0; i < 400; i++) {
      const [sa, sb] = [['wedge', 'round'], ['wedge', 'wedge'], ['round', 'round']][i % 3];
      const A = placeOutline(HULLS[sa], { x: 0, y: 0, rotation: r() * 360 - 180 });
      const B = placeOutline(HULLS[sb], { x: (r() - 0.5) * 700, y: (r() - 0.5) * 700, rotation: r() * 360 - 180 });
      const want = oracle(A, B);
      expect(convexIntersect(A, B), `case ${i}`).toBe(want);
      if (want) hits++;
      else misses++;
    }
    expect(hits).toBeGreaterThan(40);
    expect(misses).toBeGreaterThan(40);
  });

  it('a rotated wedge near a round: overlap follows the real geometry, not the bounding boxes', () => {
    const round = piece('r', 'round', 0, 0);
    const R = placeOutline(HULLS.round, round);
    // Slide a turned wedge in along the diagonal and stop just before it touches the round: there, the bounding boxes
    // overlap well before the shapes do.
    const bboxOverlap = (W: Pt[]) =>
      Math.min(...W.map((p) => p.x)) < Math.max(...R.map((p) => p.x)) - 10 && Math.min(...W.map((p) => p.y)) < Math.max(...R.map((p) => p.y)) - 10;
    let found: { x: number; rot: number } | null = null;
    for (let rot = -180; rot < 180 && !found; rot += 5) {
      let last = -1;
      for (let d = 600; d > 0; d -= 1) {
        if (convexIntersect(placeOutline(HULLS.wedge, { x: d, y: d, rotation: rot }), R)) break;
        last = d;
      }
      if (last > 0 && bboxOverlap(placeOutline(HULLS.wedge, { x: last, y: last, rotation: rot }))) found = { x: last, rot };
    }
    expect(found, 'a configuration where only the bounding boxes overlap exists').not.toBeNull();
    const w = piece('w', 'wedge', found!.x, found!.x, found!.rot);
    expect(piecesOverlap(w, round, hullOf)).toBe(false);
    expect(oracle(placeOutline(HULLS.wedge, w), R)).toBe(false);
    // Turning the wedge about its centroid, at the same spot, can make it overlap, and the test sees that.
    let overlapsAt: number | null = null;
    for (let rot = -180; rot < 180; rot += 3) {
      const t = { ...w, rotation: rot };
      const got = piecesOverlap(t, round, hullOf);
      expect(got, `rotation ${rot}`).toBe(oracle(placeOutline(HULLS.wedge, t), R));
      if (got && overlapsAt === null) overlapsAt = rot;
    }
    expect(overlapsAt, 'some rotation of the wedge overlaps the round there').not.toBeNull();
  });

  it('piece vs box: selects only pieces whose real outline intersects the box', () => {
    const round = piece('r', 'round', 0, 0);
    const R = placeOutline(HULLS.round, round);
    const minX = Math.min(...R.map((p) => p.x)), minY = Math.min(...R.map((p) => p.y));
    // A small box in the round's bounding-box corner: inside the bounding box, outside the oval.
    const corner = boxFromCorners({ x: minX - 5, y: minY - 5 }, { x: minX + 15, y: minY + 15 });
    expect(convexIntersect(R, boxPolygon(corner))).toBe(false);
    expect(piecesInBox([round], hullOf, corner)).toEqual([]);
    // A box across the oval's edge, a box inside it, and a box around it all select it.
    expect(piecesInBox([round], hullOf, boxFromCorners({ x: -200, y: -5 }, { x: 0, y: 5 }))).toEqual(['r']);
    expect(piecesInBox([round], hullOf, boxFromCorners({ x: -5, y: -5 }, { x: 5, y: 5 }))).toEqual(['r']);
    expect(piecesInBox([round], hullOf, boxFromCorners({ x: -500, y: -500 }, { x: 500, y: 500 }))).toEqual(['r']);
    // Corners in any order; an empty box selects nothing.
    expect(boxFromCorners({ x: 5, y: 9 }, { x: -1, y: 2 })).toEqual({ x: -1, y: 2, w: 6, h: 7 });
    expect(piecesInBox([round], hullOf, { x: 0, y: 0, w: 0, h: 0 })).toEqual([]);
    // Rotated pieces: a wedge turned 90 degrees, tested against the box with the oracle.
    const w = piece('w', 'wedge', 0, 0, 90);
    const W = placeOutline(HULLS.wedge, w);
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const b = boxFromCorners({ x: (r() - 0.5) * 600, y: (r() - 0.5) * 600 }, { x: (r() - 0.5) * 600, y: (r() - 0.5) * 600 });
      expect(piecesInBox([w], hullOf, b).length === 1, `box ${i}`).toBe(oracle(W, boxPolygon(b)));
    }
  });
});

describe('rigid selection rotation', () => {
  const group = [piece('a', 'wedge', 0, 0, 10), piece('b', 'round', 300, -40, -35), piece('c', 'sq', -120, 220, 170)];
  const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);

  it('positions orbit the centre and rotations add the same angle', () => {
    const c = { x: 50, y: 60 };
    const out = rotateRigid(group, c, 90);
    expect(out[0].x).toBeCloseTo(c.x - (0 - c.y), 9); // (x, y) -> (cx - (y - cy), cy + (x - cx)) for +90
    expect(out[0].y).toBeCloseTo(c.y + (0 - c.x), 9);
    expect(out.map((p) => p.rotation)).toEqual([100, 55, -100]);
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves every pairwise distance, every relative angle and every outline point distance (the arrangement is invariant)', () => {
    const r = rng(11);
    for (let t = 0; t < 50; t++) {
      const deg = r() * 720 - 360;
      const c = { x: (r() - 0.5) * 1000, y: (r() - 0.5) * 1000 };
      const out = rotateRigid(group, c, deg);
      for (let i = 0; i < group.length; i++) {
        expect(dist(out[i], c)).toBeCloseTo(dist(group[i], c), 9);
        for (let j = i + 1; j < group.length; j++) {
          expect(dist(out[i], out[j])).toBeCloseTo(dist(group[i], group[j]), 9);
          const rel = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;
          expect(rel(out[i].rotation, out[j].rotation)).toBeCloseTo(rel(group[i].rotation, group[j].rotation), 9);
          const A0 = placeOutline(hullOf(group[i].shapeId), group[i]), B0 = placeOutline(hullOf(group[j].shapeId), group[j]);
          const A1 = placeOutline(hullOf(out[i].shapeId), out[i]), B1 = placeOutline(hullOf(out[j].shapeId), out[j]);
          expect(dist(A1[0], B1[3])).toBeCloseTo(dist(A0[0], B0[3]), 8);
        }
      }
    }
  });

  it('turning back by the same angle restores the pieces; translating moves them all alike', () => {
    const c = { x: 12, y: -7 };
    const back = rotateRigid(rotateRigid(group, c, 37.5), c, -37.5);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(group[i].x, 9);
      expect(p.y).toBeCloseTo(group[i].y, 9);
      expect(p.rotation).toBeCloseTo(group[i].rotation, 9);
    });
    const moved = translateAll(group, 5, -3);
    expect(moved.map((p) => [p.x, p.y])).toEqual(group.map((p) => [p.x + 5, p.y - 3]));
  });

  it("the selection frame turns with the selection: same box, same centre, when rotated about that centre", () => {
    const f0 = selectionFrame(group, hullOf, 0)!;
    const out = rotateRigid(group, f0.centre, 33);
    const f1 = selectionFrame(out, hullOf, 33)!;
    expect(f1.box.w).toBeCloseTo(f0.box.w, 6);
    expect(f1.box.h).toBeCloseTo(f0.box.h, 6);
    expect(f1.centre.x).toBeCloseTo(f0.centre.x, 6);
    expect(f1.centre.y).toBeCloseTo(f0.centre.y, 6);
    expect(selectionFrame([], hullOf)).toBeNull();
  });
});

describe('overlap-aware stacking', () => {
  /** Overlap from an explicit list of pairs. */
  const ov = (pairs: string[]) => {
    const s = new Set(pairs.flatMap((p) => [p, [...p].reverse().join('')]));
    return (a: string, b: string) => s.has(a + b);
  };
  const sel = (...ids: string[]) => new Set(ids);

  it('a single piece passes a non-overlapping neighbour to get above the next piece it overlaps', () => {
    // a b c d (bottom to top); a overlaps c only.
    expect(bringForwardOverlapping(['a', 'b', 'c', 'd'], sel('a'), ov(['ac']))).toEqual(['b', 'c', 'a', 'd']);
    // Send backward is the mirror: d overlaps b only.
    expect(sendBackwardOverlapping(['a', 'b', 'c', 'd'], sel('d'), ov(['db']))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('only one overlapping piece is passed per step', () => {
    expect(bringForwardOverlapping(['a', 'b', 'c'], sel('a'), ov(['ab', 'ac']))).toEqual(['b', 'a', 'c']);
  });

  it('a selection with interleaved unselected pieces keeps its own order and the others keep theirs', () => {
    // Stack: s1 u1 s2 u2 u3 s3 u4. Selected: s1, s2, s3. s2 overlaps u3 (u1 and u2 overlap nothing selected).
    const order = ['s1', 'u1', 's2', 'u2', 'u3', 's3', 'u4'];
    const out = bringForwardOverlapping(order, sel('s1', 's2', 's3'), ov(['s2u3']))!;
    expect(out).toEqual(['u1', 'u2', 'u3', 's1', 's2', 's3', 'u4']);
    const inner = out.filter((id) => id.startsWith('s'));
    const outer = out.filter((id) => id.startsWith('u'));
    expect(inner).toEqual(['s1', 's2', 's3']);
    expect(outer).toEqual(['u1', 'u2', 'u3', 'u4']);
    // s3 overlaps u4: the next step passes u4 with everything.
    expect(bringForwardOverlapping(out, sel('s1', 's2', 's3'), ov(['s2u3', 's3u4']))).toEqual(['u1', 'u2', 'u3', 'u4', 's1', 's2', 's3']);
    // Backward, mirrored: s3 overlaps u1, so every selected piece above u1 (s2, s3) drops to just below it, in order.
    const back = sendBackwardOverlapping(['u0', 's1', 'u1', 's2', 'u2', 's3'], sel('s1', 's2', 's3'), ov(['s3u1']))!;
    expect(back).toEqual(['u0', 's1', 's2', 's3', 'u1', 'u2']);
  });

  it('pieces the selection already sits above, and pieces it does not overlap, keep their place relative to it', () => {
    // u0 is below everything selected: untouched. s3 is already above the target u2: it stays above.
    const out = bringForwardOverlapping(['u0', 's1', 'u1', 'u2', 's3', 'u3'], sel('s1', 's3'), ov(['s1u2', 's1u0']))!;
    expect(out).toEqual(['u0', 'u1', 'u2', 's1', 's3', 'u3']);
  });

  it('is a no-op (null) when nothing above, or below, overlaps; including at the top and bottom of the stack', () => {
    expect(bringForwardOverlapping(['a', 'b', 'c'], sel('a'), ov([]))).toBeNull();
    expect(sendBackwardOverlapping(['a', 'b', 'c'], sel('c'), ov([]))).toBeNull();
    expect(bringForwardOverlapping(['a', 'b', 'c'], sel('c'), ov(['ca', 'cb'])), 'already on top').toBeNull();
    expect(sendBackwardOverlapping(['a', 'b', 'c'], sel('a'), ov(['ab', 'ac'])), 'already at the bottom').toBeNull();
    expect(bringForwardOverlapping(['a', 'b'], sel('a', 'b'), ov(['ab'])), 'everything selected').toBeNull();
    expect(bringForwardOverlapping(['a', 'b', 'c'], sel(), ov(['ab']))).toBeNull();
    // Overlap only BELOW does not let it go forward.
    expect(bringForwardOverlapping(['a', 'b', 'c'], sel('b'), ov(['ab']))).toBeNull();
  });

  it('works with real geometry: a rotated wedge passes a far-away round to get above the round it overlaps', () => {
    const pieces = [
      piece('w', 'wedge', 0, 0, 30),
      piece('far', 'round', 2000, 0),
      piece('near', 'round', 150, 40),
    ];
    const by = new Map(pieces.map((p) => [p.id, p]));
    const overlaps = (a: string, b: string) => piecesOverlap(by.get(a)!, by.get(b)!, hullOf);
    expect(overlaps('w', 'near')).toBe(true);
    expect(overlaps('w', 'far')).toBe(false);
    expect(bringForwardOverlapping(['w', 'far', 'near'], sel('w'), overlaps)).toEqual(['far', 'near', 'w']);
  });
});

describe('selection helpers', () => {
  it('select all returns every piece in stacking order; toggle adds or removes one', () => {
    expect(selectAll([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])).toEqual(['p1', 'p2', 'p3']);
    expect(selectAll([])).toEqual([]);
    expect(toggleInSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleInSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(toggleInSelection([], 'a')).toEqual(['a']);
  });
});
