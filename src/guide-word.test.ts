import { describe, expect, it } from 'vitest';
import {
  BESIDE_ORDER, adoptTheirs, anchorWord, askGuide, answerAsk, activeOutlines, besideSpot, chooseWord, cOutlines, currentSection, findWordC, guideBuilt,
  guideClearPlan, guideProgress, observeGuide, placeWordC, recordBuilt, rectsOverlap, rigidShift, startGuide, type GuideState, type GuideWorld, type Rect,
} from './guide';
import { filledBy, type Outline, type OutlinePiece, type ShapeFrame } from './outline';
import { rotatedBounds } from './camera';
import { splitSections } from './sections';
import { History } from './history';

/**
 * v1.2.3: the guided c is the c INSIDE word-create-1, so it stays in place as the start of "create" at Guide me.
 *
 * The five shapes' frames (bounding box and area centroid, source units) as src/shapes.ts computes them in a browser (the
 * same snapshot as src/sections.test.ts; the browser suite checks the live behaviour).
 */
const FRAMES: Record<string, ShapeFrame> = {
  'positive-stem': { bbox: { x: 192.47, y: 29.13, w: 115.06, h: 441.74 }, centroid: { x: 249.9985901053713, y: 249.9945337615658 } },
  'positive-round': { bbox: { x: 121.1840591430664, y: 106.5191879272461, w: 246.6747055053711, h: 294.7682571411133 }, centroid: { x: 244.524795388271, y: 253.90367068058842 } },
  'negative-stem': { bbox: { x: 210.93, y: 29.38, w: 78.14, h: 441.24 }, centroid: { x: 249.99608457621085, y: 249.97968507659988 } },
  'negative-round': { bbox: { x: 169.85494995117188, y: 154.17918395996094, w: 160.29974365234375, h: 191.64622497558594 }, centroid: { x: 250.00357461065482, y: 250.00796454050885 } },
  wedge: { bbox: { x: 38.11, y: 101.02, w: 423.78, h: 297.96 }, centroid: { x: 278.6766666666666, y: 257.7133333333333 } },
};
const shapeOf = (id: string) => FRAMES[id];
const sizeOf = (id: string) => Math.max(FRAMES[id].bbox.w, FRAMES[id].bbox.h);
const world = (pieces: readonly OutlinePiece[]): GuideWorld => ({ pieces, sizeOf });

// Edward's REAL word-create-1 (read only; nothing in src/suggestions/ is touched).
const files = import.meta.glob('./suggestions/word-create-1.json', { eager: true, import: 'default' }) as Record<string, { pieces: { s: string; x: number; y: number; r: number }[] }>;
const CREATE: Outline[] = Object.values(files)[0].pieces.map((p) => ({ shapeId: p.s, x: p.x, y: p.y, rotation: p.r }));

const on = (id: string, o: Outline): OutlinePiece => ({ id, ...o });
const ov = (a: Rect, b: Rect) => rectsOverlap(a, b);
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('findWordC: the c inside the word', () => {
  it('finds the c in the REAL word-create-1: the round at index 0, its negative round at (-0.4, 4.0), the wedge at 101.22 degrees', () => {
    const c = findWordC(CREATE, shapeOf)!;
    expect(c).toEqual({ round: 0, negative: 1, wedge: 2 });
    const [r, n, w] = cOutlines(CREATE, c);
    expect(r).toMatchObject({ shapeId: 'positive-round', x: 123.3 });
    expect(n.shapeId).toBe('negative-round');
    expect(n.x - r.x).toBeCloseTo(-0.4, 9);
    expect(n.y - r.y).toBeCloseTo(4.0, 9);
    expect(w).toMatchObject({ shapeId: 'wedge', rotation: 101.22 });
    expect(Math.hypot(w.x - r.x, w.y - r.y), 'about 102 units to its right').toBeCloseTo(102, 0);
    expect(w.x).toBeGreaterThan(r.x);
  });

  it('is not tied to indices: the same pieces are found however the word is ordered', () => {
    const perm = CREATE.map((_, i) => i).reverse();
    const shuffled = perm.map((i) => CREATE[i]);
    const c = findWordC(shuffled, shapeOf)!;
    expect([perm[c.round], perm[c.negative], perm[c.wedge]]).toEqual([0, 1, 2]);
  });

  it('robust matching: the leftmost round, the negative round overlapping it MOST, the NEAREST wedge beside them', () => {
    const R = (x: number, y = 0): Outline => ({ shapeId: 'positive-round', x, y, rotation: 0 });
    const N = (x: number, y = 0): Outline => ({ shapeId: 'negative-round', x, y, rotation: 0 });
    const W = (x: number, y = 0, r = 100): Outline => ({ shapeId: 'wedge', x, y, rotation: r });
    // A negative round only grazing the round, and one sitting on it; a far wedge, and one beside the pair.
    const word = [W(2000), N(150), R(1000), R(0), N(4, 3), W(110, 0), W(120, 300)];
    expect(findWordC(word, shapeOf)).toEqual({ round: 3, negative: 4, wedge: 5 });
    expect(findWordC([R(0), W(100)], shapeOf), 'no negative round').toBeNull();
    expect(findWordC([R(0), N(0), W(5000)], shapeOf), 'no wedge beside them').toBeNull();
    expect(findWordC([N(0), W(100)], shapeOf), 'no round').toBeNull();
    expect(findWordC([R(0), N(2000), W(100)], shapeOf), 'a negative round that does not touch it').toBeNull();
  });
});

describe('placement: the c chosen from the WHOLE word\'s bounds', () => {
  const c = findWordC(CREATE, shapeOf)!;

  it('blank board: the word\'s bounds are centred in the view, the c at its left, arranged exactly as in the word', () => {
    const centre = { x: 717.3, y: -41.27 };
    const { word, c: three } = placeWordC(CREATE, c, shapeOf, centre);
    const b = rotatedBounds(word, shapeOf)!;
    expect(Math.abs(b.x + b.w / 2 - centre.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(b.y + b.h / 2 - centre.y)).toBeLessThanOrEqual(0.05);
    const cb = rotatedBounds(three, shapeOf)!;
    expect(cb.x - b.x, 'the c starts at the word\'s left edge').toBeLessThan(1);
    expect(cb.x + cb.w / 2, 'no longer centred on its own').toBeLessThan(centre.x - 500);
    const orig = cOutlines(CREATE, c);
    for (let i = 1; i < 3; i++) {
      expect(three[i].x - three[0].x).toBeCloseTo(orig[i].x - orig[0].x, 9);
      expect(three[i].y - three[0].y).toBeCloseTo(orig[i].y - orig[0].y, 9);
      expect(three[i].rotation).toBe(orig[i].rotation);
    }
    expect(three.map((o) => o.shapeId)).toEqual(['positive-round', 'negative-round', 'wedge']);
  });

  it('Keep my pieces: the spot is chosen for the whole word beside their work, so no outline of the word ever overlaps their pieces', () => {
    const theirs: Outline[] = [
      { shapeId: 'positive-stem', x: 0, y: 0, rotation: 0 }, { shapeId: 'positive-round', x: 170, y: -60, rotation: 0 },
      { shapeId: 'wedge', x: 330, y: 40, rotation: 45 }, { shapeId: 'negative-stem', x: 20, y: 0, rotation: 90 },
    ];
    const work = rotatedBounds(theirs, shapeOf)!;
    const own = rotatedBounds(CREATE, shapeOf)!;
    const avoid = theirs.map((p) => rotatedBounds([p], shapeOf)!);
    for (const view of [{ x: 0, y: 0, w: 1440, h: 840 }, { x: 0, y: 60, w: 393, h: 640 }, { x: 0, y: 0, w: 700, h: 330 }]) {
      for (const order of [BESIDE_ORDER, ['left', 'above'] as const]) {
        const spot = besideSpot(work, { w: own.w, h: own.h }, { margin: 230, view, pad: 32, minZoom: 0.2, avoid, order });
        const { word, c: three } = placeWordC(CREATE, c, shapeOf, { x: spot.rect.x + spot.rect.w / 2, y: spot.rect.y + spot.rect.h / 2 });
        const wb = rotatedBounds(word, shapeOf)!;
        expect(ov(wb, work), `${spot.side}: the word's bounds clear of their work`).toBe(false);
        for (const a of avoid) expect(ov(wb, a)).toBe(false);
        for (const o of word) for (const a of avoid) expect(ov(rotatedBounds([o], shapeOf)!, a)).toBe(false);
        // The c is the word's c there: Guide me will anchor the word exactly where it was planned.
        expect(anchorWord(CREATE, c, three, shapeOf, avoid)).toEqual(word);
      }
    }
  });
});

describe('Guide me on the c: no clear, the c counts, progress starts at 3 of 32', () => {
  const c = findWordC(CREATE, shapeOf)!;
  const { word: planned, c: letter } = placeWordC(CREATE, c, shapeOf, { x: 400, y: 120 });
  const built = letter.map((o, i) => on(['a', 'b', 'w'][i], o));
  const at4 = (): GuideState => recordBuilt(observeGuide(startGuide(letter, world([])), world(built)), ['a', 'b', 'w']);

  it('the word goes in the same board frame as the c: its three pieces sit exactly on their outlines, which count as filled', () => {
    const s4 = at4();
    expect(s4.step).toBe(4);
    const outlines = anchorWord(CREATE, c, s4.letter, shapeOf)!;
    expect(outlines).toEqual(planned);
    expect([outlines[0], outlines[1], outlines[2]], 'the c\'s outlines are the built c').toEqual(letter);
    const s5 = chooseWord(s4, outlines, world(built));
    expect([s5.step, s5.phase]).toEqual([5, 'word']);
    expect(guideProgress(s5)).toEqual({ done: 3, total: 32 });
    expect(s5.filled.slice(0, 3)).toEqual(['a', 'b', 'w']);
    expect(activeOutlines(s5), 'the c\'s outlines are not shown').toEqual(Array.from({ length: 29 }, (_, i) => i + 3));
    // Nothing on the board changed (no clear): the same pieces, still guide-built.
    expect(guideBuilt(s5, built)).toEqual(['a', 'b', 'w']);
  });

  it('Start fresh at the end still removes the guide-built pieces only (the c included, as part of the word)', () => {
    const mine = [on('m', { shapeId: 'positive-stem', x: -3000, y: 0, rotation: 0 })];
    let s = recordBuilt(answerAsk(askGuide(), 'keep', letter, world(mine), ['m']), ['a', 'b', 'w']);
    s = observeGuide(s, world([...mine, ...built]));
    s = chooseWord(s, anchorWord(CREATE, c, s.letter, shapeOf)!, world([...mine, ...built]));
    const rest = planned.slice(3).map((o, i) => on(`k${i}`, o));
    s = observeGuide(recordBuilt(s, rest.map((p) => p.id)), world([...mine, ...built, ...rest]));
    expect(s.step).toBe(6);
    expect(guideClearPlan(s, [...mine, ...built, ...rest])).toEqual({ all: false, ids: [...built, ...rest].map((p) => p.id) });
  });

  it('phones: section 1 holds the c, already filled, so it shows only its remaining outlines', () => {
    const sections = splitSections(CREATE, shapeOf, 6);
    expect(sections[0]).toEqual(expect.arrayContaining([0, 1, 2]));
    const s5 = chooseWord(at4(), anchorWord(CREATE, c, letter, shapeOf)!, world(built), sections);
    expect(currentSection(s5)).toBe(0);
    expect(activeOutlines(s5)).toEqual(sections[0].filter((i) => i > 2).sort((a, b) => a - b));
    expect(activeOutlines(s5)).toEqual([4, 7]);
    // A word whose first section is only the c starts at the next one.
    const only = chooseWord(at4(), anchorWord(CREATE, c, letter, shapeOf)!, world(built), [[0, 1, 2], CREATE.slice(3).map((_, i) => i + 3)]);
    expect([currentSection(only), activeOutlines(only).length]).toEqual([1, 29]);
  });

  it('undo across the step 4 -> 5 boundary keeps the c: Guide me adds no undo step; an undo there takes back the c\'s last action only, and the guide stays on the word', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    h.record([built[0]]);
    h.record([built[0], built[1]]);
    const unturned = { ...built[2], rotation: 0 };
    h.record([built[0], built[1], unturned]); // the wedge dropped close, unturned
    h.record(built); // ...then turned in
    let s = recordBuilt(observeGuide(startGuide(letter, world([])), world(h.present)), ['a', 'b', 'w']);
    expect(s.step).toBe(4);
    const before = h.present;
    s = chooseWord(s, anchorWord(CREATE, c, s.letter, shapeOf)!, world(h.present));
    expect(h.present, 'Guide me changed nothing on the board').toBe(before);
    expect(guideProgress(s).done).toBe(3);
    s = observeGuide(s, world(h.undo()!));
    expect(h.present.map((p) => p.id), 'the c is still on the board').toEqual(['a', 'b', 'w']);
    expect([s.step, s.phase, guideProgress(s).done, s.turn]).toEqual([5, 'word', 2, 'w']);
    expect(activeOutlines(s)[0], 'the wedge\'s outline shows again').toBe(2);
    s = observeGuide(s, world(h.redo()!));
    expect([s.step, guideProgress(s).done]).toEqual([5, 3]);
  });
});

describe('the c moved after step 3, before Guide me', () => {
  const c = findWordC(CREATE, shapeOf)!;
  const { c: letter } = placeWordC(CREATE, c, shapeOf, { x: 0, y: 0 });
  const built = letter.map((o, i) => on(['a', 'b', 'w'][i], o));
  const at4 = () => recordBuilt(observeGuide(startGuide(letter, world([])), world(built)), ['a', 'b', 'w']);
  const moved = (dx: number, dy: number, turn = 0) => built.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy, rotation: p.rotation + turn }));

  it('moved as one (rigidly, as built): it is still the c; its outlines and the word re-anchor on the round where it is now', () => {
    const s4 = at4();
    const away = moved(312.37, -48.1);
    const s = observeGuide(s4, world(away));
    expect(s.step, 'still "That\'s a c."').toBe(4);
    expect(close(s.letter[0].x, away[0].x) && close(s.letter[0].y, away[0].y)).toBe(true);
    expect(filledBy(s.letter, away)).toEqual(['a', 'b', 'w']);
    const outlines = anchorWord(CREATE, c, s.letter, shapeOf)!;
    expect(outlines).not.toBeNull();
    for (let i = 0; i < CREATE.length; i++) {
      expect(outlines[i].x - away[0].x).toBeCloseTo(CREATE[i].x - CREATE[0].x, 5);
      expect(outlines[i].y - away[0].y).toBeCloseTo(CREATE[i].y - CREATE[0].y, 5);
    }
    const s5 = chooseWord(s, outlines, world(away));
    expect(guideProgress(s5)).toEqual({ done: 3, total: 32 });
    // Undoing the move: the outlines follow it back.
    const back = observeGuide(s, world(built));
    expect(back.step).toBe(4);
    back.letter.forEach((o, i) => {
      expect(o.x).toBeCloseTo(letter[i].x, 9);
      expect(o.y).toBeCloseTo(letter[i].y, 9);
    });
  });

  it('turned, or broken apart: not the c as built any more; the step goes back (the word is never anchored on it)', () => {
    expect(rigidShift(letter, ['a', 'b', 'w'], moved(100, 0, 10))).toBeNull();
    expect(observeGuide(at4(), world(moved(100, 0, 10))).step).toBe(1);
    const apart = [...moved(100, 0).slice(0, 2), built[2]];
    expect(observeGuide(at4(), world(apart)).step, "the round and its negative moved, the wedge left behind").toBe(1);
    expect(rigidShift(letter, ['a', 'b', 'w'], built), 'not moved at all').toBeNull();
    const turnedLetter = letter.map((o) => ({ ...o, rotation: o.rotation + 10 }));
    expect(anchorWord(CREATE, c, turnedLetter, shapeOf), 'a turned c is not this word\'s c').toBeNull();
  });

  it('fallback: moved next to other pieces (the word would overlap them), the c becomes theirs and the word is placed fresh', () => {
    const s4 = at4();
    const theirs = rotatedBounds([{ shapeId: 'positive-stem', x: 900, y: 0, rotation: 0 }], shapeOf)!;
    expect(anchorWord(CREATE, c, s4.letter, shapeOf, [theirs])).toBeNull();
    const s = adoptTheirs(s4, ['a', 'b', 'w']);
    expect([s.theirs, s.built]).toEqual([['a', 'b', 'w'], []]);
    expect(guideBuilt(s, built), 'never removed by the guide').toEqual([]);
    expect(adoptTheirs(s, ['a'])).toBe(s);
  });
});
