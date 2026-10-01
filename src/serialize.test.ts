import { describe, expect, it } from 'vitest';
import { MAX_PIECES, SHAPE_IDS, deserialize, serialize, serializeToString } from './serialize';

const pieces = [
  { shapeId: 'positive-stem', x: 10.04, y: -20.06, rotation: 33.337 },
  { shapeId: 'wedge', x: 0, y: -0, rotation: -180 },
];

describe('serialize', () => {
  it('writes the versioned compact format with rounding and stacking order', () => {
    expect(serialize(pieces)).toEqual({
      v: 1,
      pieces: [
        { s: 'positive-stem', x: 10, y: -20.1, r: 33.34 },
        { s: 'wedge', x: 0, y: 0, r: 180 },
      ],
    });
    expect(Object.is(serialize(pieces).pieces[1].y, -0)).toBe(false);
  });

  it('round-trips (values already rounded survive unchanged), including via a string', () => {
    const once = serialize(pieces);
    for (const input of [once, JSON.stringify(once), serializeToString(pieces)]) {
      const r = deserialize(input);
      expect(r).toMatchObject({ ok: true, dropped: 0 });
      if (r.ok) expect(serialize(r.pieces)).toEqual(once);
    }
  });

  it('round-trips an empty composition', () => {
    expect(deserialize(serialize([]))).toEqual({ ok: true, pieces: [], dropped: 0 });
  });

  it('keeps every shape id in step with src/shapes/*.svg', () => {
    const files = Object.keys(import.meta.glob('./shapes/*.svg', { query: '?raw' })).map((f) => f.replace(/^.*\/|\.svg$/g, ''));
    expect([...files].sort()).toEqual([...SHAPE_IDS].sort());
  });
});

describe('deserialize rejects bad input without throwing', () => {
  it.each([
    ['not json', 'nope{'],
    ['null', null],
    ['undefined', undefined],
    ['number', 5],
    ['array', []],
    ['missing version', { pieces: [] }],
    ['unknown version', { v: 2, pieces: [] }],
    ['string version', { v: '1', pieces: [] }],
    ['pieces not an array', { v: 1, pieces: {} }],
    ['missing pieces', { v: 1 }],
  ])('%s -> error', (_n, input) => {
    expect(deserialize(input)).toMatchObject({ ok: false });
  });

  it('rejects a payload over the piece cap', () => {
    const many = Array.from({ length: MAX_PIECES + 1 }, () => ({ s: 'wedge', x: 0, y: 0, r: 0 }));
    expect(deserialize({ v: 1, pieces: many })).toMatchObject({ ok: false });
    expect(deserialize({ v: 1, pieces: many.slice(0, MAX_PIECES) })).toMatchObject({ ok: true });
  });

  it('drops bad pieces and keeps the good ones in order', () => {
    const r = deserialize({
      v: 1,
      pieces: [
        { s: 'wedge', x: 1, y: 2, r: 3 },
        { s: 'banana', x: 1, y: 2, r: 3 },
        { s: 'wedge', x: NaN, y: 2, r: 3 },
        { s: 'wedge', x: '1', y: 2, r: 3 },
        { s: 'wedge', x: 1, y: Infinity, r: 3 },
        { s: 'wedge', x: 1e9, y: 0, r: 0 },
        { s: 'wedge', x: 1, y: 2 },
        { s: 7, x: 1, y: 2, r: 3 },
        null,
        'x',
        [],
        { s: 'positive-round', x: 5, y: 6, r: 540 },
      ],
    });
    expect(r).toEqual({
      ok: true,
      dropped: 10,
      pieces: [
        { shapeId: 'wedge', x: 1, y: 2, rotation: 3 },
        { shapeId: 'positive-round', x: 5, y: 6, rotation: 180 },
      ],
    });
  });

  it('never throws on hostile objects', () => {
    const evil = { get v(): number { throw new Error('boom'); } };
    expect(deserialize(evil)).toMatchObject({ ok: false });
  });
});
