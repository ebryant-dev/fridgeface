/**
 * Undo/redo over immutable snapshots. Pure, no DOM.
 *
 * `present` is the latest recorded state. Each `record` is one user action = one undo step.
 * Pass the same `key` for rapid repeats of one action (e.g. arrow-key nudges of one piece): records
 * with an equal key within `coalesceMs` of the previous one merge into the same step.
 * A new record clears the redo stack. The undo stack is capped (oldest steps drop first).
 */
export interface HistoryOptions<T> {
  cap?: number;
  coalesceMs?: number;
  equals?: (a: T, b: T) => boolean;
}

export const HISTORY_CAP = 200;
export const COALESCE_MS = 600;

export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private cur: T;
  private lastKey: string | null = null;
  private lastTime = 0;
  private readonly cap: number;
  private readonly coalesceMs: number;
  private readonly equals: (a: T, b: T) => boolean;

  constructor(initial: T, opts: HistoryOptions<T> = {}) {
    this.cur = initial;
    this.cap = opts.cap ?? HISTORY_CAP;
    this.coalesceMs = opts.coalesceMs ?? COALESCE_MS;
    this.equals = opts.equals ?? ((a, b) => a === b);
  }

  get present(): T {
    return this.cur;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoDepth(): number {
    return this.undoStack.length;
  }

  /** The states `undo` would step back to, most recent first, at most `n` of them (nothing changes). */
  past(n: number = Infinity): T[] {
    const out: T[] = [];
    for (let i = this.undoStack.length - 1; i >= 0 && out.length < n; i--) out.push(this.undoStack[i]);
    return out;
  }

  /** Record a new state as one step. Returns false if it equals the present (nothing recorded). */
  record(next: T, key: string | null = null, now: number = Date.now()): boolean {
    if (this.equals(next, this.cur)) return false;
    const merge = key !== null && key === this.lastKey && now - this.lastTime <= this.coalesceMs && this.undoStack.length > 0;
    this.redoStack = [];
    if (merge) {
      this.cur = next;
      this.lastTime = now;
      // The run ended where it began: drop the now-empty step.
      if (this.equals(next, this.undoStack[this.undoStack.length - 1])) {
        this.undoStack.pop();
        this.lastKey = null;
      }
      return true;
    }
    this.undoStack.push(this.cur);
    if (this.undoStack.length > this.cap) this.undoStack.splice(0, this.undoStack.length - this.cap);
    this.cur = next;
    this.lastKey = key;
    this.lastTime = now;
    return true;
  }

  /**
   * Fold `next` into the step that produced the present state (no new undo step): a follow-up that belongs to the action
   * just recorded, such as the guide clicking a released piece into its outline. One undo then goes back past both.
   * Returns false if it equals the present.
   */
  amend(next: T): boolean {
    if (this.equals(next, this.cur)) return false;
    this.redoStack = [];
    this.cur = next;
    this.lastKey = null;
    return true;
  }

  /** Step back. Returns the state to show, or undefined if there is nothing to undo. */
  undo(): T | undefined {
    if (!this.undoStack.length) return undefined;
    this.redoStack.push(this.cur);
    this.cur = this.undoStack.pop() as T;
    this.lastKey = null;
    return this.cur;
  }

  redo(): T | undefined {
    if (!this.redoStack.length) return undefined;
    this.undoStack.push(this.cur);
    this.cur = this.redoStack.pop() as T;
    this.lastKey = null;
    return this.cur;
  }

  /** Start over from `state` with empty stacks. */
  reset(state: T) {
    this.cur = state;
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
  }
}
