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

  it('reorders the stacking order as one change, refusing anything but a permutation of the current ids', () => {
    const { c, a, b, d } = three();
    const fn = vi.fn();
    c.onChange(fn);
    expect(c.reorder([b, a, d])).toBe(true);
    expect(ids(c)).toEqual([b, a, d]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.reorder([b, a, d])).toBe(false); // unchanged
    expect(c.reorder([b, a])).toBe(false); // missing one
    expect(c.reorder([b, a, a])).toBe(false); // duplicate
    expect(c.reorder([b, a, 'nope'])).toBe(false);
    expect(ids(c)).toEqual([b, a, d]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deletes several pieces as one change', () => {
    const { c, a, b, d } = three();
    const fn = vi.fn();
    c.onChange(fn);
    expect(c.deletePieces([a, d, 'nope'])).toBe(2);
    expect(ids(c)).toEqual([b]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.deletePieces([a])).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('moves and rotates several pieces as one change, keeping stacking order', () => {
    const { c, a, b, d } = three();
    const fn = vi.fn();
    c.onChange(fn);
    expect(c.setPlacements([{ id: a, x: 5, y: 6, rotation: 190 }, { id: d, x: 7, y: 8 }, { id: 'nope', x: 0, y: 0 }])).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getPiece(a)).toMatchObject({ x: 5, y: 6, rotation: -170 });
    expect(c.getPiece(d)).toMatchObject({ x: 7, y: 8, rotation: 0 });
    expect(ids(c)).toEqual([a, b, d]);
    expect(c.setPlacements([{ id: a, x: 5, y: 6, rotation: -170 }])).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('replaces the pieces array on change and notifies listeners only on real changes', () => {
    const { c, a, d } = three();
    const fn = vi.fn();
    const off = c.onChange(fn);
    const before = c.pieces;
    c.reorder([...ids(c)]); // no-op
    expect(fn).not.toHaveBeenCalled();
    c.reorder([d, ...ids(c).slice(0, 2)]);
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

  it('addPieces adds several on top as ONE change, in order, with fresh ids', () => {
    const { c, a } = three();
    const fn = vi.fn();
    c.onChange(fn);
    const added = c.addPieces([{ shapeId: 'wedge', x: 1, y: 2, rotation: 190 }, { shapeId: 'positive-stem', x: 3, y: 4, rotation: 0 }]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.pieces).toHaveLength(5);
    expect(c.pieces.slice(3).map((p) => p.shapeId)).toEqual(['wedge', 'positive-stem']);
    expect(c.pieces[3].rotation).toBe(-170);
    expect(new Set(ids(c)).size).toBe(5);
    expect(ids(c)[0]).toBe(a);
    expect(added.map((p) => p.id)).toEqual(ids(c).slice(3));
    expect(c.addPieces([])).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
