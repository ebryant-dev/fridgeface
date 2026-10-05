import { describe, expect, it } from 'vitest';
import {
  CLICK_ANGLE_DEG, CLICK_POS_FRACTION, activeIndices, angleGap, clickIn, clickTarget, filledBy, needsTurning, outlineMatch, outlinesAt,
  sitsOn, stackFix, type Outline, type OutlinePiece,
} from './outline';
import { History } from './history';

const size = () => 100; // every shape 100 units across: 18 units and 12 degrees of tolerance
const o = (shapeId: string, x: number, y: number, rotation = 0): Outline => ({ shapeId, x, y, rotation });
const p = (id: string, shapeId: string, x: number, y: number, rotation = 0): OutlinePiece => ({ id, shapeId, x, y, rotation });

describe('tolerances', () => {
  it('are about 18% of the shape and 12 degrees', () => {
    expect(CLICK_POS_FRACTION).toBe(0.18);
    expect(CLICK_ANGLE_DEG).toBe(12);
  });
});

describe('angleGap', () => {
  it('is the smaller angle, wrapping around', () => {
    expect(angleGap(10, 350)).toBe(20);
    expect(angleGap(179, -179)).toBe(2);
    expect(angleGap(111.03, -248.97)).toBeCloseTo(0, 9);
    expect(angleGap(0, 180)).toBe(180);
  });
});

describe('outlineMatch', () => {
  const t = o('wedge', 0, 0, 111);
  it('fit: right shape, within 18% in position and 12 degrees in angle (both edges)', () => {
    expect(outlineMatch(t, p('a', 'wedge', 18, 0, 111), size)).toBe('fit');
    expect(outlineMatch(t, p('a', 'wedge', 0, 0, 123), size)).toBe('fit');
    expect(outlineMatch(t, p('a', 'wedge', 0, 0, 99), size)).toBe('fit');
    expect(outlineMatch(t, p('a', 'wedge', 0, 0, -251), size)).toBe('fit'); // = 109, the other way round
  });
  it('near: close in position, needs turning', () => {
    expect(outlineMatch(t, p('a', 'wedge', 5, 5, 0), size)).toBe('near');
    expect(outlineMatch(t, p('a', 'wedge', 0, 0, 124), size)).toBe('near');
  });
  it('far: the wrong shape, or too far', () => {
    expect(outlineMatch(t, p('a', 'positive-round', 0, 0, 111), size)).toBe('far');
    expect(outlineMatch(t, p('a', 'wedge', 18.1, 0, 111), size)).toBe('far');
  });
});

describe('filledBy / sitsOn', () => {
  it('a piece fills an outline only exactly on it (rounding aside); each piece fills one outline', () => {
    const os = [o('r', 0, 0), o('r', 0, 0), o('s', 50, 0, 30)];
    expect(sitsOn(os[2], p('x', 's', 50.1, 0, 30.01))).toBe(true);
    expect(sitsOn(os[2], p('x', 's', 51, 0, 30))).toBe(false);
    expect(filledBy(os, [p('a', 'r', 0, 0), p('b', 's', 50, 0, 30)])).toEqual(['a', null, 'b']);
    expect(filledBy(os, [p('a', 'r', 0, 0), p('c', 'r', 0, 0)])).toEqual(['c', 'a', null]); // the topmost first
    expect(activeIndices(['a', null, 'b', null])).toEqual([1, 3]);
  });
});

describe('clickTarget / clickIn', () => {
  const os = [o('r', 0, 0), o('n', 0, 0), o('w', 100, 0, 111)];
  it('the nearest fitting ACTIVE, unfilled outline; none without active outlines (no snapping outside the guide)', () => {
    expect(clickTarget(os, [0, 1, 2], [null, null, null], p('x', 'r', 3, 3), size)).toBe(0);
    expect(clickTarget(os, [1, 2], [null, null, null], p('x', 'r', 3, 3), size)).toBeNull();
    expect(clickTarget(os, [0], ['y', null, null], p('x', 'r', 3, 3), size)).toBeNull(); // already filled
    expect(clickIn(os, [], [p('x', 'r', 1, 1)], ['x'], size)).toBeNull();
    expect(clickIn(os, [0], [p('x', 'r', 1, 1)], [], size)).toBeNull();
  });
  it('snaps to exactly the outline; a far piece stays', () => {
    const r = clickIn(os, [0, 1, 2], [p('x', 'r', 4, -6, 5), p('f', 'w', 400, 0, 111)], ['x', 'f'], size)!;
    expect(r.placements).toEqual([{ id: 'x', x: 0, y: 0, rotation: 0, outline: 0 }]);
    expect(r.order).toBeNull();
  });
  it('needsTurning names a near, mis-angled piece of an active outline', () => {
    expect(needsTurning(os, [2], [null, null, null], [p('w1', 'w', 105, 0, 0)], size)).toBe('w1');
    expect(needsTurning(os, [2], [null, null, null], [p('w1', 'w', 105, 0, 110)], size)).toBeNull(); // it would fit
    expect(needsTurning(os, [0], [null, null, null], [p('w1', 'w', 105, 0, 0)], size)).toBeNull(); // not active
  });
});

describe('stackFix', () => {
  it('filled pieces take their slots in the suggestion order; everything else keeps its place', () => {
    expect(stackFix(['n', 'x', 'p'], ['p', 'n'])).toEqual(['p', 'x', 'n']);
    expect(stackFix(['a', 'b', 'c'], ['a', null, 'c'])).toEqual(['a', 'b', 'c']);
    expect(stackFix(['z', 'c', 'b', 'a'], ['a', 'b', 'c'])).toEqual(['z', 'a', 'b', 'c']);
  });
  it('clickIn fixes the order in the same result (one undo step with the release)', () => {
    const os = [o('pos', 0, 0), o('neg', 0, 0)];
    const r = clickIn(os, [0], [p('n', 'neg', 0, 0), p('q', 'pos', 2, 2)], ['q'], size)!;
    expect(r.order).toEqual(['q', 'n']);
    // History: the release and its click-in are ONE step.
    const h = new History<string>('before');
    h.record('dropped');
    h.amend('clicked in');
    expect(h.undoDepth).toBe(1);
    expect(h.undo()).toBe('before');
    expect(h.redo()).toBe('clicked in');
    expect(h.amend('clicked in')).toBe(false);
  });
});

describe('outlinesAt', () => {
  it('moves a suggestion rigidly so its bounds are centred on a point, rounded like the wire format', () => {
    const frame = () => ({ bbox: { x: -10, y: -10, w: 20, h: 20 }, centroid: { x: 0, y: 0 } });
    const out = outlinesAt([o('s', 0, 0, 0), o('s', 100, 0, 360.004)], frame, { x: 1000.04, y: 50 });
    expect(out).toEqual([o('s', 950, 50, 0), o('s', 1050, 50, 0)]);
    expect(outlinesAt([], frame, { x: 0, y: 0 })).toEqual([]);
  });
});
