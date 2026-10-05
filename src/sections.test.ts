import { describe, expect, it } from 'vitest';
import { CLEAR_GAP, centreXs, sectionOf, splitSections } from './sections';
import type { Outline, ShapeFrame } from './outline';

/**
 * The five shapes' frames (bounding box and area centroid, source units), as src/shapes.ts computes them from the SVGs in
 * a browser (shapes.ts needs the DOM, unit tests run in Node). The browser suite checks the live split equals the snapshot
 * below, so a change to a shape would show there too.
 */
const FRAMES: Record<string, ShapeFrame> = {
  'positive-stem': { bbox: { x: 192.47, y: 29.13, w: 115.06, h: 441.74 }, centroid: { x: 249.9985901053713, y: 249.9945337615658 } },
  'positive-round': { bbox: { x: 121.1840591430664, y: 106.5191879272461, w: 246.6747055053711, h: 294.7682571411133 }, centroid: { x: 244.524795388271, y: 253.90367068058842 } },
  'negative-stem': { bbox: { x: 210.93, y: 29.38, w: 78.14, h: 441.24 }, centroid: { x: 249.99608457621085, y: 249.97968507659988 } },
  'negative-round': { bbox: { x: 169.85494995117188, y: 154.17918395996094, w: 160.29974365234375, h: 191.64622497558594 }, centroid: { x: 250.00357461065482, y: 250.00796454050885 } },
  wedge: { bbox: { x: 38.11, y: 101.02, w: 423.78, h: 297.96 }, centroid: { x: 278.6766666666666, y: 257.7133333333333 } },
};
const shapeOf = (id: string) => FRAMES[id];

// Edward's REAL word-create-1 (read only; nothing in src/suggestions/ is touched).
const files = import.meta.glob('./suggestions/word-create-1.json', { eager: true, import: 'default' }) as Record<string, { text: string; pieces: { s: string; x: number; y: number; r: number }[] }>;
const CREATE = Object.values(files)[0];
const createPieces: Outline[] = CREATE.pieces.map((p) => ({ shapeId: p.s, x: p.x, y: p.y, rotation: p.r }));

/** A synthetic piece: a negative round (its rotated bounds are centred on x) at `x`. */
const at = (x: number): Outline => ({ shapeId: 'negative-round', x, y: 0, rotation: 0 });

/** Every piece in exactly one section, none empty, sections left to right by centre x. */
function wellFormed(sections: number[][], pieces: readonly Outline[]) {
  const all = sections.flat().sort((a, b) => a - b);
  expect(all).toEqual(pieces.map((_, i) => i));
  for (const s of sections) expect(s.length).toBeGreaterThan(0);
  const xs = centreXs(pieces, shapeOf);
  for (let k = 1; k < sections.length; k++) expect(Math.min(...sections[k].map((i) => xs[i]))).toBeGreaterThanOrEqual(Math.max(...sections[k - 1].map((i) => xs[i])));
  for (const s of sections) for (let j = 1; j < s.length; j++) expect(xs[s[j]]).toBeGreaterThanOrEqual(xs[s[j - 1]]);
}

describe('splitSections', () => {
  it('splits at the natural gaps: three clusters of three, three sections', () => {
    const pieces = [0, 40, 80, 400, 440, 480, 800, 840, 880].map(at);
    const s = splitSections(pieces, shapeOf, 3);
    expect(s).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8]]);
    wellFormed(s, pieces);
  });

  it('is balanced on evenly spaced pieces (no gap stands out)', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => at(i * 50));
    const s = splitSections(pieces, shapeOf, 4);
    expect(s.map((x) => x.length)).toEqual([3, 3, 3, 3]);
    wellFormed(s, pieces);
  });

  it('orders by centre x, not by stacking order, and is deterministic', () => {
    const pieces = [at(900), at(10), at(450), at(20), at(910), at(460)];
    const a = splitSections(pieces, shapeOf, 3);
    expect(a).toEqual([[1, 3], [2, 5], [0, 4]]);
    expect(splitSections(pieces, shapeOf, 3)).toEqual(a);
    wellFormed(a, pieces);
  });

  it('allows ONE extra section only at a clear gap', () => {
    // Two letters' worth, then a far-off extra part (a "flower"): 3 sections for count 2.
    const word = [0, 50, 100, 150, 200, 250].map(at);
    const extra = [2000, 2050].map(at);
    const s = splitSections([...word, ...extra], shapeOf, 2);
    expect(s).toHaveLength(3);
    expect(s[2]).toEqual([6, 7]);
    // No clear gap (evenly spaced): exactly `count` sections.
    expect(splitSections(Array.from({ length: 8 }, (_, i) => at(i * 50)), shapeOf, 2)).toHaveLength(2);
    expect(CLEAR_GAP).toBeGreaterThan(1);
  });

  it('copes with edge cases: empty, one piece, more sections than pieces, unknown shapes', () => {
    expect(splitSections([], shapeOf, 6)).toEqual([]);
    expect(splitSections([at(5)], shapeOf, 6)).toEqual([[0]]);
    const three = [at(0), at(500), at(1000)];
    expect(splitSections(three, shapeOf, 6)).toEqual([[0], [1], [2]]);
    const odd: Outline[] = [{ shapeId: 'nope', x: 300, y: 0, rotation: 0 }, at(0)];
    expect(splitSections(odd, shapeOf, 1)).toEqual([[1, 0]]);
  });

  it('sectionOf maps each piece to its section', () => {
    expect(sectionOf([[2, 0], [1]], 3)).toEqual([0, 1, 0]);
  });
});

describe('the REAL word-create-1', () => {
  it('splits into 7 sections: 5 across the letters, 2 for the flower past the clear gap (snapshot)', () => {
    expect(CREATE.text).toBe('create');
    expect(createPieces).toHaveLength(32);
    const s = splitSections(createPieces, shapeOf, CREATE.text.length);
    wellFormed(s, createPieces);
    const xs = centreXs(createPieces, shapeOf);
    const summary = s.map((sec) => ({ n: sec.length, pieces: sec, x: [Math.round(Math.min(...sec.map((i) => xs[i]))), Math.round(Math.max(...sec.map((i) => xs[i])))] }));
    expect(summary).toEqual([
      { n: 5, pieces: [1, 0, 2, 7, 4], x: [123, 275] },
      { n: 5, pieces: [5, 3, 6, 8, 9], x: [371, 594] },
      { n: 5, pieces: [10, 11, 13, 14, 12], x: [705, 854] },
      { n: 6, pieces: [15, 24, 16, 17, 19, 18], x: [945, 1252] },
      { n: 4, pieces: [20, 22, 23, 21], x: [1342, 1528] },
      { n: 3, pieces: [26, 28, 31], x: [1870, 1965] },
      { n: 4, pieces: [25, 30, 29, 27], x: [2039, 2220] },
    ]);
    // Roughly balanced: no section more than twice another.
    const n = s.map((x) => x.length);
    expect(Math.max(...n)).toBeLessThanOrEqual(2 * Math.min(...n));
  });
});
