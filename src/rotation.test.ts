import { describe, expect, it } from 'vitest';
import { Composition } from './composition';
import { fromUpright, normalise, rotationFor, snapNearest, snapTowardUpright, stepFromUpright, uprightBounds } from './rotation';

// Rest-pose angles from upright, as measured in src/shapes.ts (shapes.ts needs a DOM, which unit tests lack;
// the browser check confirms these live values).
const OFFSETS: Record<string, number> = {
  'positive-stem': 8.38, 'positive-round': -9.12, 'negative-stem': 3.48, 'negative-round': 8.93, wedge: -22.1,
};
const offset = (id: string) => OFFSETS[id];

describe('normalise', () => {
  it('maps to (-180, 180]', () => {
    expect(normalise(180)).toBe(180);
    expect(normalise(-180)).toBe(180);
    expect(normalise(190)).toBe(-170);
    expect(normalise(-190)).toBe(170);
    expect(normalise(720)).toBe(0);
    expect(normalise(-0)).toBe(0);
  });
});

describe('rest poses under truncate-toward-upright', () => {
  const expected: Record<string, number> = {
    'positive-stem': 0, 'positive-round': 0, 'negative-stem': 0, 'negative-round': 0, wedge: -15,
  };
  for (const [id, want] of Object.entries(expected)) {
    it(`${id} rest pose -> ${want}`, () => {
      const fu = fromUpright(offset(id), 0);
      expect(snapTowardUpright(fu)).toBe(want);
      expect(fromUpright(offset(id), rotationFor(offset(id), want))).toBeCloseTo(want, 9);
    });
  }
});

describe('snapTowardUpright', () => {
  it('truncates toward 0 for positive and negative angles', () => {
    expect(snapTowardUpright(14.9)).toBe(0);
    expect(snapTowardUpright(29.9)).toBe(15);
    expect(snapTowardUpright(-14.9)).toBe(0);
    expect(snapTowardUpright(-29.9)).toBe(-15);
    expect(snapTowardUpright(-22.1)).toBe(-15);
  });
  it('wraps near +-180 (truncation goes toward 0, i.e. away from 180)', () => {
    expect(snapTowardUpright(179)).toBe(165);
    expect(snapTowardUpright(-179)).toBe(-165);
    expect(snapTowardUpright(181)).toBe(-165);
    expect(snapTowardUpright(180)).toBe(180);
    expect(snapTowardUpright(-180)).toBe(180);
  });
  it('leaves on-step angles alone', () => {
    expect(snapTowardUpright(45)).toBe(45);
    expect(snapTowardUpright(45 + 1e-9)).toBe(45);
  });
});

describe('snapNearest', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapNearest(7)).toBe(0);
    expect(snapNearest(8)).toBe(15);
    expect(snapNearest(-8)).toBe(-15);
    expect(snapNearest(178)).toBe(180);
    expect(snapNearest(-178)).toBe(180);
    expect(snapNearest(188)).toBe(-165);
  });
});

describe('stepFromUpright', () => {
  it('steps from on-step angles', () => {
    expect(stepFromUpright(0, 1)).toBe(15);
    expect(stepFromUpright(0, -1)).toBe(-15);
    expect(stepFromUpright(-15, 1)).toBe(0);
    expect(stepFromUpright(165, 1)).toBe(180);
    expect(stepFromUpright(180, 1)).toBe(-165);
    expect(stepFromUpright(-165, -1)).toBe(180);
  });
  it('snaps toward upright first when off-step, in either direction', () => {
    expect(stepFromUpright(20, 1)).toBe(15);
    expect(stepFromUpright(20, -1)).toBe(15);
    expect(stepFromUpright(-20, 1)).toBe(-15);
    expect(stepFromUpright(8.38, 1)).toBe(0);
  });
});

describe('Composition rotation', () => {
  it('sets and rotates without changing order or position', () => {
    const c = new Composition();
    const a = c.addPiece('positive-stem', 5, 6);
    const b = c.addPiece('wedge', 10, 11);
    const d = c.addPiece('positive-round', 20, 21);
    const order = c.pieces.map((p) => p.id);
    let calls = 0;
    c.onChange(() => calls++);
    expect(c.setRotation(b.id, 30)).toBe(true);
    expect(c.rotatePiece(b.id, 170)).toBe(true);
    expect(c.getPiece(b.id)!.rotation).toBe(-160);
    expect(calls).toBe(2);
    expect(c.setRotation(b.id, -160)).toBe(false);
    expect(c.setRotation('nope', 1)).toBe(false);
    expect(calls).toBe(2);
    expect(c.pieces.map((p) => p.id)).toEqual(order);
    expect(c.getPiece(b.id)).toMatchObject({ x: 10, y: 11 });
    expect(c.getPiece(a.id)).toMatchObject({ x: 5, y: 6, rotation: 0 });
    expect(c.getPiece(d.id)).toMatchObject({ x: 20, y: 21, rotation: 0 });
  });
});

describe('uprightBounds', () => {
  it('measures a tilted bar in its upright frame', () => {
    // A 10 x 100 bar, centred on the origin, drawn tilted 30 degrees clockwise.
    const th = (30 * Math.PI) / 180;
    const pts = [[-5, -50], [5, -50], [5, 50], [-5, 50]].map(([x, y]) => ({ x: x * Math.cos(th) - y * Math.sin(th), y: x * Math.sin(th) + y * Math.cos(th) }));
    const b = uprightBounds(pts, { x: 0, y: 0 }, 30);
    expect(b.w).toBeCloseTo(10, 6);
    expect(b.h).toBeCloseTo(100, 6);
    expect(b.x).toBeCloseTo(-5, 6);
    expect(b.y).toBeCloseTo(-50, 6);
  });
});
