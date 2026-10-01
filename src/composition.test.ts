import { describe, expect, it, vi } from 'vitest';
import { Composition } from './composition';

const ids = (c: Composition) => c.pieces.map((p) => p.id);

function three() {
  const c = new Composition();
  const a = c.addPiece('positive-stem', 0, 0);
  const b = c.addPiece('wedge', 10, 10);
  const d = c.addPiece('positive-round', 20, 20);
  return { c, a: a.id, b: b.id, d: d.id };
}

describe('Composition', () => {
  it('adds pieces on top, rest pose, with the given position', () => {
    const { c, a, b, d } = three();
    expect(ids(c)).toEqual([a, b, d]);
    expect(c.pieces[2]).toMatchObject({ shapeId: 'positive-round', x: 20, y: 20, rotation: 0 });
  });

  it('keeps ids unique, even after deletions', () => {
    const c = new Composition();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = c.addPiece('wedge', i, i);
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
      if (i % 3 === 0) c.deletePiece(p.id);
    }
  });

  it('moves a piece without changing stacking order', () => {
    const { c, a, b, d } = three();
    expect(c.movePiece(b, 55, 66)).toBe(true);
    expect(c.getPiece(b)).toMatchObject({ x: 55, y: 66 });
    expect(ids(c)).toEqual([a, b, d]);
    expect(c.movePiece('nope', 1, 1)).toBe(false);
    expect(c.movePiece(b, 55, 66)).toBe(false);
  });

  it('deletes a piece', () => {
    const { c, a, b, d } = three();
    expect(c.deletePiece(b)).toBe(true);
    expect(ids(c)).toEqual([a, d]);
    expect(c.deletePiece(b)).toBe(false);
  });

  it('brings forward one step', () => {
    const { c, a, b, d } = three();
    expect(c.bringForward(a)).toBe(true);
    expect(ids(c)).toEqual([b, a, d]);
  });

  it('sends backward one step', () => {
    const { c, a, b, d } = three();
    expect(c.sendBackward(d)).toBe(true);
    expect(ids(c)).toEqual([a, d, b]);
  });

  it('does nothing at the edges', () => {
    const { c, a, b, d } = three();
    expect(c.bringForward(d)).toBe(false);
    expect(c.sendBackward(a)).toBe(false);
    expect(c.bringForward('nope')).toBe(false);
    expect(ids(c)).toEqual([a, b, d]);
  });

  it('replaces the pieces array on change and notifies listeners only on real changes', () => {
    const { c, a, d } = three();
    const fn = vi.fn();
    const off = c.onChange(fn);
    const before = c.pieces;
    c.bringForward(d); // no-op
    expect(fn).not.toHaveBeenCalled();
    c.bringForward(a);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.pieces).not.toBe(before);
    off();
    c.addPiece('wedge', 0, 0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clear empties the board once; replace assigns fresh ids in order; restore puts a snapshot back', () => {
    const { c } = three();
    const snap = c.pieces;
    expect(c.clear()).toBe(true);
    expect(c.clear()).toBe(false);
    expect(c.pieces).toEqual([]);
    c.restore(snap);
    expect(c.pieces).toBe(snap);
    c.replace([{ shapeId: 'wedge', x: 1, y: 2, rotation: 190 }, { shapeId: 'positive-stem', x: 3, y: 4, rotation: 0 }]);
    expect(c.pieces.map((p) => p.shapeId)).toEqual(['wedge', 'positive-stem']);
    expect(c.pieces[0].rotation).toBe(-170);
    expect(new Set(c.pieces.map((p) => p.id)).size).toBe(2);
    expect(snap.map((p) => p.id)).not.toContain(c.pieces[0].id);
  });
});
