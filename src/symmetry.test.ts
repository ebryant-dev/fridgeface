import { describe, expect, it } from 'vitest';
import positiveStemSvg from './shapes/positive-stem.svg?raw';
import positiveRoundSvg from './shapes/positive-round.svg?raw';
import negativeStemSvg from './shapes/negative-stem.svg?raw';
import negativeRoundSvg from './shapes/negative-round.svg?raw';
import wedgeSvg from './shapes/wedge.svg?raw';
import { SYMMETRY_TOL, symmetryDeviations, symmetryOrder, type SymPt } from './symmetry';
import { clickIn, filledBy, outlineMatch, outlinesAt, periodOf, settleRotation, sitsOn, type OutlinePiece, type ShapeFrame } from './outline';
import { guideClickIn, observeGuide, startGuide, type GuideWorld } from './guide';

/**
 * The REAL geometry (src/shapes/*.svg, read as text). shapes.ts samples it with the browser's path engine; here the rounds'
 * cubic Béziers are sampled directly (no DOM in unit tests). Same source numbers, so the same symmetry.
 */
function outlineOf(svg: string): SymPt[] {
  const poly = /points="([^"]+)"/.exec(svg);
  if (poly) {
    const n = poly[1].trim().split(/[\s,]+/).map(Number);
    const pts: SymPt[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
    if (pts.length > 1 && pts[0].x === pts.at(-1)!.x && pts[0].y === pts.at(-1)!.y) pts.pop();
    return pts;
  }
  const d = /\sd="([^"]+)"/.exec(svg)![1];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g)!;
  const pts: SymPt[] = [];
  let i = 0, cmd = '', cur = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const o = rel ? cur : { x: 0, y: 0 };
    if (/[Mm]/.test(cmd)) cur = { x: o.x + num(), y: o.y + num() };
    else if (/[Cc]/.test(cmd)) {
      const p1 = { x: o.x + num(), y: o.y + num() }, p2 = { x: o.x + num(), y: o.y + num() }, p3 = { x: o.x + num(), y: o.y + num() };
      for (let k = 0; k < 64; k++) {
        const t = k / 64, u = 1 - t;
        pts.push({
          x: u * u * u * cur.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * cur.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
      cur = p3;
    } else if (/[Hh]/.test(cmd)) cur = { x: (rel ? cur.x : 0) + num(), y: cur.y };
    else if (/[Zz]/.test(cmd)) continue;
    else throw new Error(`unexpected path command ${cmd}`);
  }
  return pts;
}

function areaCentroid(pts: SymPt[]): SymPt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const REAL = { 'positive-stem': positiveStemSvg, 'positive-round': positiveRoundSvg, 'negative-stem': negativeStemSvg, 'negative-round': negativeRoundSvg, wedge: wedgeSvg };
const measured = Object.fromEntries(
  Object.entries(REAL).map(([id, svg]) => {
    const pts = outlineOf(svg);
    const c = areaCentroid(pts);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); // close to the upright size; only scales the tolerance
    return [id, { order: symmetryOrder(pts, c, size), dev: symmetryDeviations(pts, c, size) }];
  }),
) as Record<keyof typeof REAL, { order: number; dev: Record<2 | 3 | 4, number> }>;

describe('rotational symmetry, measured from the real shapes', () => {
  it('stems and rounds turn onto themselves at 180 degrees (the rounds too: their offset axis is a tilt, still point-symmetric)', () => {
    for (const id of ['positive-stem', 'negative-stem', 'positive-round', 'negative-round'] as const) {
      expect(measured[id].dev[2], `${id} at 180`).toBeLessThan(0.001); // well inside 1.5%
      expect(measured[id].dev[3], `${id} at 120`).toBeGreaterThan(SYMMETRY_TOL);
      expect(measured[id].dev[4], `${id} at 90`).toBeGreaterThan(SYMMETRY_TOL);
      expect(measured[id].order, id).toBe(2);
    }
  });
  it('the wedge has no rotational symmetry', () => {
    for (const n of [2, 3, 4] as const) expect(measured.wedge.dev[n]).toBeGreaterThan(0.1);
    expect(measured.wedge.order).toBe(1);
  });
  it('a square has order 4 and an equilateral triangle order 3 (the test itself)', () => {
    const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    expect(symmetryOrder(sq, { x: 0, y: 0 }, 2)).toBe(4);
    const tri = [0, 120, 240].map((a) => ({ x: Math.sin((a * Math.PI) / 180), y: -Math.cos((a * Math.PI) / 180) }));
    expect(symmetryOrder(tri, { x: 0, y: 0 }, 2)).toBe(3);
  });
});

describe('outlines treat symmetric rotations as equal', () => {
  const frame = (id: string): ShapeFrame => ({ bbox: { x: 0, y: 0, w: 100, h: 100 }, centroid: { x: 50, y: 50 }, symmetry: measured[id as keyof typeof REAL]?.order });
  const sizeOf = () => 100;
  const [oval, wedge] = outlinesAt(
    [{ shapeId: 'negative-round', x: 0, y: 0, rotation: 20 }, { shapeId: 'wedge', x: 300, y: 0, rotation: 101.22 }], frame, { x: 150, y: 0 },
  );
  const pc = (id: string, shapeId: string, x: number, y: number, rotation: number): OutlinePiece => ({ id, shapeId, x, y, rotation });

  it('outlines carry their shape\'s period: 180 for an oval, none for the wedge', () => {
    expect(oval.period).toBe(180);
    expect(wedge.period).toBeUndefined();
    expect(periodOf(2)).toBe(180);
    expect(periodOf(1)).toBe(360);
  });

  it('an oval at its outline\'s angle + 180 fits, and clicks in WITHOUT spinning (it stays at +180, which looks identical)', () => {
    const p = pc('a', 'negative-round', oval.x + 5, oval.y - 4, oval.rotation + 180 + 7);
    expect(outlineMatch(oval, p, sizeOf)).toBe('fit');
    const r = clickIn([oval], [0], [p], ['a'], sizeOf)!;
    expect(r.placements).toHaveLength(1);
    const pl = r.placements[0];
    expect([pl.x, pl.y]).toEqual([oval.x, oval.y]);
    expect(pl.rotation).toBeCloseTo(-160, 9); // 20 + 180, normalised: the equivalent angle nearest the piece's 207
    expect(Math.abs(pl.rotation + 360 - p.rotation)).toBeCloseTo(7, 9); // it turns only the 7 degrees it was off
    expect(settleRotation(oval, oval.rotation + 3)).toBe(oval.rotation); // near the outline's own angle: that one
    const placed = { ...p, ...pl };
    expect(sitsOn(oval, placed)).toBe(true);
    expect(filledBy([oval], [placed])).toEqual(['a']);
  });

  it('the wedge at its outline\'s angle + 180 does NOT fit: it needs turning', () => {
    const p = pc('w', 'wedge', wedge.x + 5, wedge.y, wedge.rotation + 180);
    expect(outlineMatch(wedge, p, sizeOf)).toBe('near');
    expect(clickIn([wedge], [0], [p], ['w'], sizeOf)).toBeNull();
    expect(sitsOn(wedge, { ...p, x: wedge.x, y: wedge.y })).toBe(false);
  });

  it('in the guide: a black oval dropped half a turn round clicks in, the step moves on, and the 4b hint works the same way', () => {
    const C = outlinesAt(
      [{ shapeId: 'positive-round', x: 0, y: 0, rotation: 15 }, { shapeId: 'negative-round', x: -0.4, y: 4, rotation: 15 }, { shapeId: 'wedge', x: 102, y: 0, rotation: 101.22 }],
      frame, { x: 0, y: 0 },
    );
    const w = (ps: OutlinePiece[]): GuideWorld => ({ pieces: ps, sizeOf });
    const white = pc('b', 'negative-round', C[1].x, C[1].y, C[1].rotation - 180); // exactly on it, half a turn round: filled
    let s = startGuide(C, w([white]));
    expect(s.step).toBe(2);
    const black = pc('a', 'positive-round', C[0].x + 3, C[0].y + 2, C[0].rotation + 185);
    const r = guideClickIn(s, w([white, black]), ['a'])!;
    expect(r.placements[0].rotation).toBeCloseTo(C[0].rotation + 180 - 360, 9); // the near equivalent: 195 -> -165, 5 degrees away
    const placed = { ...black, ...r.placements[0] };
    s = observeGuide(s, w([white, placed]));
    expect(s.step, 'it landed on top: step 3, send it back').toBe(3);
    s = observeGuide(s, w([placed, white]));
    expect(s.step).toBe(4);
    // Step 4: a wedge half a turn round is close but needs turning (4b); an oval would not have.
    const wd = pc('w', 'wedge', C[2].x, C[2].y, C[2].rotation + 180);
    s = observeGuide(s, w([placed, white, wd]));
    expect([s.step, s.turn]).toEqual([4, 'w']);
  });
});
