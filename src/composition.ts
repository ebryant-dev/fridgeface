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

  /** Move one step toward the top. No change (false) if already on top. */
  bringForward(id: string): boolean {
    return this.step(id, 1);
  }

  /** Move one step toward the bottom. No change (false) if already at the bottom. */
  sendBackward(id: string): boolean {
    return this.step(id, -1);
  }

  private step(id: string, dir: 1 | -1): boolean {
    const i = this.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.list.length) return false;
    const next = this.list.slice();
    [next[i], next[j]] = [next[j], next[i]];
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
