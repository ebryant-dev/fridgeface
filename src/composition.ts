/**
 * Composition model: the pieces on the board and their stacking order.
 * No DOM code. Units are board units (= source SVG units).
 *
 * A piece's (x, y) is where the shape's area centroid sits on the board;
 * `rotation` is degrees relative to the rest pose (always 0 until rotation ships).
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

  private set(next: readonly Piece[]) {
    this.list = next;
    for (const fn of [...this.listeners]) fn(this.list);
  }
}
