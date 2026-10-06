import { bringForwardOverlapping, sendBackwardOverlapping } from './selection';
import type { OutlinePiece } from './outline';

/**
 * Stacking in the guide (v1.3.0, copy v3). Pure, no DOM.
 *
 * The guide never fixes the **stacking order** for the visitor: a piece clicks into its outline in position and angle only,
 * and stays wherever it is in the stacking order. A word piece is DONE when it is placed (sits exactly on its outline) AND
 * its order is right against every other placed word piece it actually OVERLAPS (real geometry): for each such pair, the
 * one whose outline comes first in the suggestion (bottom first) is the lower one. Pairs that do not overlap never matter.
 *
 * ORDER-FREE PAIRS (v1.5.0): a word may declare pairs of outlines whose relative order does not matter (the flower's petals in
 * "create": petal over petal reads the same either way; guide-plans.ts). Such a pair is never checked, never makes a piece
 * mis-stacked and never causes a prompt, whatever its order on the board. Every other overlapping pair keeps the rule above.
 *
 * When a placed piece is stacked wrongly, the guide prompts the visitor to fix it with the button block's overlap-aware Send
 * backward or Bring forward (selection.ts): `stackPrompt` picks the piece (the most recently placed first), the direction
 * and the fewest presses, by simulating those very presses on the whole board.
 */

/** Real-geometry overlap of two pieces on the board. */
export type Overlaps = (a: OutlinePiece, b: OutlinePiece) => boolean;

/** Pairs of outline indices whose relative stacking order does not matter (order-free; see the file comment). */
export type FreePairs = readonly (readonly [number, number])[];

/** A fast test for `pairs`: is the pair (i, j) (either way round) order-free? */
export function freeTest(pairs: FreePairs = []): (i: number, j: number) => boolean {
  if (!pairs.length) return () => false;
  const set = new Set(pairs.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  return (i, j) => set.has(i < j ? `${i}:${j}` : `${j}:${i}`);
}

export interface StackCheck {
  /** Per outline: placed AND in the right order against every placed piece it overlaps. */
  done: boolean[];
  /** The placed pieces with at least one wrong overlapping pair, by id. */
  wrong: string[];
}

/**
 * Which placed pieces are in the right stacking order (see the file comment). `filled[i]`: the piece on outline i, or null.
 * `free`: order-free pairs (outline indices), never checked.
 */
export function stackCheck(filled: readonly (string | null)[], pieces: readonly OutlinePiece[], overlaps: Overlaps, free: FreePairs = []): StackCheck {
  const isFree = freeTest(free);
  const pos = new Map(pieces.map((p, i) => [p.id, i]));
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const bad = new Set<number>();
  for (let i = 0; i < filled.length; i++) {
    const a = filled[i];
    if (!a) continue;
    for (let j = i + 1; j < filled.length; j++) {
      const b = filled[j];
      if (!b || pos.get(a)! < pos.get(b)!) continue; // right order (or nothing there): nothing to check
      if (isFree(i, j)) continue; // an order-free pair: either order is right
      if (overlaps(byId.get(a)!, byId.get(b)!)) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  return {
    done: filled.map((id, i) => !!id && !bad.has(i)),
    wrong: filled.filter((id, i): id is string => !!id && bad.has(i)),
  };
}

export type StackDir = 'back' | 'forward';

export interface StackPrompt {
  /** The piece to restack. */
  id: string;
  /** Send backward ('back') or Bring forward ('forward'). */
  dir: StackDir;
  /** How many presses of that control put it right (0: it cannot be put right by itself; Next still can, see `order`). */
  presses: number;
  /** The stacking order (bottom first, every piece on the board) once it is put right: what Next applies. */
  order: string[];
}

/** How many of piece `id`'s placed, overlapping partners are on the wrong side of it in `order`. */
function wrongFor(id: string, order: readonly string[], rank: ReadonlyMap<string, number>, partners: readonly string[]): number {
  const at = order.indexOf(id);
  const mine = rank.get(id)!;
  let n = 0;
  for (const q of partners) {
    const below = order.indexOf(q) < at;
    if (below !== rank.get(q)! < mine) n++;
  }
  return n;
}

/** Up to this many presses are simulated each way (a press always passes at least one piece, so the board size is enough). */
const MAX_PRESSES = 64;

/**
 * Simulate pressing Send backward or Bring forward on `id` alone, up to the board's size: the fewest presses after which
 * `wrong(order)` is as low as it gets (0 ideally). Returns the best found each way.
 */
function simulate(id: string, order: readonly string[], ov: (a: string, b: string) => boolean, wrong: (o: readonly string[]) => number, dir: StackDir) {
  const sel = new Set([id]);
  let cur = [...order];
  let best = { w: wrong(cur), n: 0, order: cur };
  for (let n = 1; n <= Math.min(MAX_PRESSES, order.length); n++) {
    const next = dir === 'back' ? sendBackwardOverlapping(cur, sel, ov) : bringForwardOverlapping(cur, sel, ov);
    if (!next) break;
    cur = next;
    const w = wrong(cur);
    if (w < best.w) best = { w, n, order: cur };
    if (w === 0) break;
  }
  return best;
}

/** The correct order for the placed pieces, everything else where it is (the last resort for Next: see `stackPrompt`). */
export function stackRepair(order: readonly string[], filled: readonly (string | null)[]): string[] {
  const rank = new Map<string, number>();
  filled.forEach((id, i) => {
    if (id) rank.set(id, i);
  });
  const slots: number[] = [];
  order.forEach((id, i) => {
    if (rank.has(id)) slots.push(i);
  });
  const sorted = slots.map((i) => order[i]).sort((a, b) => rank.get(a)! - rank.get(b)!);
  const out = [...order];
  slots.forEach((slot, k) => (out[slot] = sorted[k]));
  return out;
}

/** A tangle is searched this many presses deep (any piece involved, either way) for a way to fewer wrong pairs. */
export const UNTANGLE_DEPTH = 5;

/**
 * The stacking prompt: which mis-stacked placed piece to restack, which way, and how many presses. Candidates are taken
 * most recently placed first (`recent`: placed ids, oldest first; any not in it come after, top of the stack first). For
 * each, both directions are simulated with the real overlap-aware presses; the direction that puts it fully right in the
 * fewest presses wins (ties: Send backward). A piece that cannot be put fully right by itself (its overlapping partners are
 * themselves out of order) yields to the next candidate that can; if none can, the first candidate that one direction
 * improves is prompted. Failing even that (a TANGLE: e.g. a piece that belongs between two others that are the wrong way
 * round, though they do not touch each other), the fewest presses of any involved piece (one that is mis-stacked, or that
 * overlaps one) that lead to fewer wrong pairs are searched (`UNTANGLE_DEPTH` deep); the prompt is the first piece and
 * direction of that sequence (the guide prompts the rest as it goes). Only when nothing is found within that depth is the
 * most recent prompted toward its first wrong partner with 0 presses, and Next repairs the whole order (`stackRepair`).
 * Null when nothing is mis-stacked. `free`: order-free pairs (outline indices): never a wrong pair, never prompted (the
 * presses themselves are simulated with the real overlaps, as the buttons press them).
 */
export function stackPrompt(
  filled: readonly (string | null)[], pieces: readonly OutlinePiece[], overlaps: Overlaps, recent: readonly string[] = [], free: FreePairs = [],
): StackPrompt | null {
  const check = stackCheck(filled, pieces, overlaps, free);
  if (!check.wrong.length) return null;
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const memo = new Map<string, boolean>();
  const ov = (a: string, b: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = memo.get(k);
    if (v === undefined) {
      const pa = byId.get(a), pb = byId.get(b);
      v = !!pa && !!pb && overlaps(pa, pb);
      memo.set(k, v);
    }
    return v;
  };
  const rank = new Map<string, number>();
  filled.forEach((id, i) => {
    if (id) rank.set(id, i);
  });
  // Overlapping AND order matters (not an order-free pair): the pairs the stacking check is about.
  const isFree = freeTest(free);
  const counts = (a: string, b: string) => ov(a, b) && !isFree(rank.get(a)!, rank.get(b)!);
  const order = pieces.map((p) => p.id);
  const wrongSet = new Set(check.wrong);
  const byRecency = [...recent].reverse().filter((id) => wrongSet.has(id));
  const rest = [...order].reverse().filter((id) => wrongSet.has(id) && !byRecency.includes(id));
  const candidates = [...byRecency, ...rest];
  const placed = filled.filter((id): id is string => !!id);
  let improving: StackPrompt | null = null;
  for (const id of candidates) {
    const partners = placed.filter((q) => q !== id && counts(id, q));
    const wrong = (o: readonly string[]) => wrongFor(id, o, rank, partners);
    const back = simulate(id, order, ov, wrong, 'back');
    const fwd = simulate(id, order, ov, wrong, 'forward');
    const pick = back.w < fwd.w || (back.w === fwd.w && back.n <= fwd.n) ? { ...back, dir: 'back' as const } : { ...fwd, dir: 'forward' as const };
    // A direction that never moves it is no answer.
    const realPick = pick.n ? pick : back.n ? { ...back, dir: 'back' as const } : fwd.n ? { ...fwd, dir: 'forward' as const } : null;
    if (realPick && realPick.w === 0) return { id, dir: realPick.dir, presses: realPick.n, order: realPick.order };
    if (realPick && !improving && realPick.w < wrong(order)) improving = { id, dir: realPick.dir, presses: realPick.n, order: realPick.order };
  }
  if (improving) return improving;
  const untangled = untangle(order, placed, rank, ov, candidates, counts);
  if (untangled) return untangled;
  const id = candidates[0];
  // Toward its first wrong partner: one below it that belongs above it means Send it back; one above that belongs below, Bring it forward.
  const at = order.indexOf(id);
  const mine = rank.get(id)!;
  const firstWrong = placed.find((q) => q !== id && counts(id, q) && (order.indexOf(q) < at) !== rank.get(q)! < mine);
  const dir: StackDir = firstWrong && order.indexOf(firstWrong) < at ? 'back' : 'forward';
  return { id, dir, presses: 0, order: stackRepair(order, filled) };
}

/**
 * A tangle: breadth first over single presses (any involved piece, Send backward then Bring forward), the fewest presses
 * after which fewer overlapping pairs are wrong. Returns the first piece and direction of that sequence, with how many
 * times in a row it is pressed at its start and the order after those presses; null when none is found within the depth.
 */
function untangle(
  order: readonly string[], placed: readonly string[], rank: ReadonlyMap<string, number>, ov: (a: string, b: string) => boolean, wrongFirst: readonly string[],
  counts: (a: string, b: string) => boolean = ov,
): StackPrompt | null {
  const pairs: [string, string][] = []; // [belongs lower, belongs higher], overlapping (order-free pairs left out), both placed
  for (const a of placed) for (const b of placed) if (rank.get(a)! < rank.get(b)! && counts(a, b)) pairs.push([a, b]);
  const wrongCount = (o: readonly string[]) => {
    const pos = new Map(o.map((id, i) => [id, i]));
    return pairs.reduce((n, [a, b]) => n + (pos.get(a)! > pos.get(b)! ? 1 : 0), 0);
  };
  const start = wrongCount(order);
  const involved = new Set(wrongFirst);
  for (const w of wrongFirst) for (const q of placed) if (ov(w, q)) involved.add(q);
  const movers = [...wrongFirst, ...placed.filter((q) => involved.has(q) && !wrongFirst.includes(q))];
  type Node = { order: readonly string[]; id: string; dir: StackDir; run: number; runOrder: readonly string[]; broke: boolean };
  const seen = new Set([order.join(',')]);
  let level: Node[] = [];
  const press = (o: readonly string[], id: string, dir: StackDir) => (dir === 'back' ? sendBackwardOverlapping : bringForwardOverlapping)(o, new Set([id]), ov);
  for (let depth = 1; depth <= UNTANGLE_DEPTH; depth++) {
    const next: Node[] = [];
    const from: (Node | null)[] = depth === 1 ? [null] : level;
    for (const n of from) {
      for (const id of movers) {
        for (const dir of ['back', 'forward'] as const) {
          const o = press(n ? n.order : order, id, dir);
          if (!o) continue;
          const key = o.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const node: Node = n
            ? { order: o, id: n.id, dir: n.dir, ...(!n.broke && n.id === id && n.dir === dir ? { run: n.run + 1, runOrder: o, broke: false } : { run: n.run, runOrder: n.runOrder, broke: true }) }
            : { order: o, id, dir, run: 1, runOrder: o, broke: false };
          if (wrongCount(o) < start) return { id: node.id, dir: node.dir, presses: node.run, order: [...node.runOrder] };
          next.push(node);
        }
      }
    }
    level = next;
    if (!level.length) break;
  }
  return null;
}
