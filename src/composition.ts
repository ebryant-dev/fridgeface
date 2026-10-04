import { normalise } from './rotation';

/**
 * Composition model: the pieces on the board and their stacking order.
 * No DOM code. Units are board units (= source SVG units).
 *
 * A piece's (x, y) is where the shape's area centroid sits on the board;
 * `rotation` is degrees relative to the rest pose (clockwise, normalised to (-180, 180]; new pieces start at 0).
 * The ARRAY ORDER IS the stacking order: last = top.
 */
export interface Piece {
  id: string;
  shapeId: string;
  x: number;
  y: number;
  rotation: number;
}

export type CompositionListener = (pieces: readonly Piece[]) => void;

export class Composition {
  private list: readonly Piece[] = [];
  private nextId = 1;
  private listeners = new Set<CompositionListener>();

  /** Pieces in stacking order, bottom first, top last. Replaced (never mutated) on every change. */
  get pieces(): readonly Piece[] {
    return this.list;
  }

  getPiece(id: string): Piece | undefined {
    return this.list.find((p) => p.id === id);
  }

  indexOf(id: string): number {
    return this.list.findIndex((p) => p.id === id);
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(fn: CompositionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Add a new piece on top of the stacking order. Returns it. */
  addPiece(shapeId: string, x: number, y: number): Piece {
    const piece: Piece = { id: `p${this.nextId++}`, shapeId, x, y, rotation: 0 };
    this.set([...this.list, piece]);
    return piece;
  }

  /** Add several pieces on top, in the given order, as ONE change (one undo step). Returns them. */
  addPieces(items: readonly { shapeId: string; x: number; y: number; rotation: number }[]): Piece[] {
    const added = items.map((it) => ({ id: `p${this.nextId++}`, shapeId: it.shapeId, x: it.x, y: it.y, rotation: normalise(it.rotation) }));
    if (added.length) this.set([...this.list, ...added]);
    return added;
  }

  /** Move a piece to an absolute position. Never changes stacking order. */
  movePiece(id: string, x: number, y: number): boolean {
    const i = this.indexOf(id);
    if (i < 0) return false;
    const cur = this.list[i];
    if (cur.x === x && cur.y === y) return false;
    const next = this.list.slice();
    next[i] = { ...cur, x, y };
    this.set(next);
    return true;
  }

  /** Set a piece's rotation (degrees clockwise from the rest pose). Never changes position or stacking order. */
  setRotation(id: string, rotation: number): boolean {
    const i = this.indexOf(id);
    if (i < 0) return false;
    const r = normalise(rotation);
    const cur = this.list[i];
    if (cur.rotation === r) return false;
    const next = this.list.slice();
    next[i] = { ...cur, rotation: r };
    this.set(next);
    return true;
  }

  /** Rotate by a relative amount (degrees clockwise). */
  rotatePiece(id: string, deltaDeg: number): boolean {
    const cur = this.getPiece(id);
    return cur ? this.setRotation(id, cur.rotation + deltaDeg) : false;
  }

  deletePiece(id: string): boolean {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.set(this.list.filter((p) => p.id !== id));
    return true;
  }

  /** Delete several pieces as ONE change (one undo step). Returns how many were deleted. */
  deletePieces(ids: Iterable<string>): number {
    const gone = new Set(ids);
    const next = this.list.filter((p) => !gone.has(p.id));
    const n = this.list.length - next.length;
    if (n) this.set(next);
    return n;
  }

  /**
   * Move and/or rotate several pieces as ONE change (a selection moving or turning as a unit). Unknown ids are ignored;
   * rotations are normalised. Never changes stacking order. False when nothing changed.
   */
  setPlacements(updates: readonly { id: string; x: number; y: number; rotation?: number }[]): boolean {
    const by = new Map(updates.map((u) => [u.id, u]));
    let changed = false;
    const next = this.list.map((p) => {
      const u = by.get(p.id);
      if (!u) return p;
      const rotation = u.rotation === undefined ? p.rotation : normalise(u.rotation);
      if (p.x === u.x && p.y === u.y && p.rotation === rotation) return p;
      changed = true;
      return { ...p, x: u.x, y: u.y, rotation };
    });
    if (changed) this.set(next);
    return changed;
  }

  /**
   * Set a new stacking order (bottom first) as ONE change. `ids` must be exactly the current ids, in any order; anything
   * else is refused (false). False too when the order is unchanged.
   */
  reorder(ids: readonly string[]): boolean {
    if (ids.length !== this.list.length) return false;
    const byId = new Map(this.list.map((p) => [p.id, p]));
    const next: Piece[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) return false;
      byId.delete(id);
      next.push(p);
    }
    if (next.every((p, i) => p === this.list[i])) return false;
    this.set(next);
    return true;
  }

  /** Remove every piece. No-op (false) if already empty. */
  clear(): boolean {
    if (!this.list.length) return false;
    this.set([]);
    return true;
  }

  /** Replace everything with new pieces (fresh ids), in the given stacking order. */
  replace(items: readonly { shapeId: string; x: number; y: number; rotation: number }[]) {
    this.set(items.map((it) => ({ id: `p${this.nextId++}`, shapeId: it.shapeId, x: it.x, y: it.y, rotation: normalise(it.rotation) })));
  }

  /** Put back a snapshot previously read from `pieces` (same ids), as undo/redo does. */
  restore(snapshot: readonly Piece[]) {
    this.set(snapshot);
  }

  private set(next: readonly Piece[]) {
    this.list = next;
    for (const fn of [...this.listeners]) fn(this.list);
  }
}
