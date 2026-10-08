import type { Outline, OutlinePiece } from './outline';
import { sameColour, type Overlaps } from './stacking';

interface Rect { x: number; y: number; w: number; h: number }
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Batches (v1.4.0): the guided word is built in STACKING ORDER, a small batch of outlines at a time, on every layout. Pure,
 * no DOM.
 *
 * A word composition lists its pieces in stacking order (bottom first). Wherever two pieces actually OVERLAP (real
 * geometry), the lower one has to be on the board before the upper one, because a new piece always lands on top. That gives
 * a dependency order (`dependencies`): outline i depends on every lower outline j < i it overlaps. Pairs that do not overlap
 * impose nothing.
 *
 * `planBatches` cuts the word into BATCHES of at most BATCH_MAX outlines. Every outline of a batch is READY when the batch
 * starts (every lower outline it overlaps is already placed: in an earlier batch, or among the pieces placed before the plan,
 * the c), and no two outlines of a batch overlap each other. Batches are chosen greedily for locality: each starts at the
 * ready outline nearest the previous batch's FIRST outline (its seed: v1.4.2; the centre of a wide batch can sit far to the
 * right and would leave a piece of it behind) (rightward moves cost a little more, so the word is swept roughly left to right
 * and nothing is left behind), then takes the ready outlines nearest the batch so far that overlap nothing already in it and keep
 * the batch within the locality window `span` (`localitySpan`, about two letters wide). A batch is MAXIMAL: it closes short of
 * BATCH_MAX only when no other ready outline that overlaps nothing in it fits the window (the automatic planner's property test). The plan is fixed when the word starts (a pure function of the word and what was already
 * placed): batches are NOT topped up as pieces go in. A fixed batch keeps its framing still while it is filled (phones
 * frame each batch close up), marks a clear "batch done" moment, and stays derivable from the board, so undo and redo move
 * between batches with no history of their own (the current batch is the first one with a piece not done).
 *
 * CORRECT BY CONSTRUCTION. Claim: if the visitor fills the batches in turn, each piece taken from the tray (or placed by Next)
 * so it lands on top of the stacking order, in ANY order within each batch, then after every placement every overlapping
 * pair of placed word pieces is in the word's order, so the guide never shows a stacking prompt and no tangle can arise.
 * Proof, by induction over placements. Before the first batch, the placed pieces (the c) are in the word's order (step 3 of
 * the c ensured it) and they are closed downward: no other word outline below one of them overlaps it (`downwardClosed`;
 * true for the real word, whose c is its three bottom pieces). Now place piece p of the current batch B, on top of
 * everything. Placing p changes no other pair's relative order, so only pairs (q, p) can go wrong, and only with q placed
 * and q overlapping p. Where is such a q?
 *   - In B: impossible, the outlines of a batch never overlap each other.
 *   - In an earlier batch or the c: q is below p on the board (p is on top). If q were ABOVE p in the word (rank q > rank p),
 *     q would depend on p (they overlap and p is lower), so q could only have been ready once p was placed: q's batch would
 *     come after p's (or q, in the c, would break downward closure). So rank q < rank p: below p, as in the word. Right.
 *   - In a later batch: not placed yet.
 * Every pair stays right, so `stackCheck` finds nothing wrong and `stackPrompt` returns null after every placement. The
 * stacking prompts remain only as the safety net for a visitor who reorders pieces themselves (or drags in a piece of their
 * own that is not on top).
 *
 * SAME-COLOUR PAIRS (v1.6.2; v1.5.0 declared them per word). The order of two pieces of the same colour never matters (stacking.ts
 * `sameColour`: black on black, white on white), so the stacking check never looks at such a pair and neither order of it is
 * an error. For a CURATED plan (`validatePlan`) a batch may then hold outlines that overlap, but ONLY when every overlapping
 * pair inside it is the same colour, and a same-colour pair is no dependency (neither needs the other placed first). The proof
 * above holds with the pairs it is about restricted to the pairs that are checked (overlapping and of different colours): q in
 * B overlapping p is then either impossible (as before) or a same-colour pair, which no order can make wrong; q in an earlier
 * batch or the c overlapping p (different colours) is below p in the word by the same dependency argument, because every
 * black/white pair keeps the old rule (it is still a dependency). So the guide still never prompts, and the word's order holds
 * for every checked pair. A batch of outlines that are ALL pairwise the same colour may also exceed BATCH_MAX (the five black
 * petals come up together); every other batch keeps the limit. The automatic planner (`planBatches`) keeps the stricter
 * rules (every overlap is a dependency), so its plans are unchanged; the relaxed rule applies to validating curated plans.
 */

/** At most this many outlines in a batch. */
export const BATCH_MAX = 4;
/** A rightward step to the next batch's first outline costs this much more than the same step leftward (per unit). */
export const BATCH_RIGHT_COST = 0.5;

/**
 * The locality window (`BatchOptions.span`), board units: the width of `perWindow` (two) average letters of the word, that
 * is the word's whole width (its outlines' bounds together, the flower's extra part included) divided by its letter count,
 * times two. Two letters is the view Edward accepted on a phone. Counting the flower is the sensible choice here: without
 * it the window would be narrower than the old 1.6 positive stems and the batches would only get smaller; with it, for
 * "create" (width about 2368, 6 letters) the window is about 789, 1.8 stems.
 */
export function localitySpan(boxes: readonly Rect[], letters: number, perWindow = 2): number {
  if (!boxes.length) return Infinity;
  const all = boxes.reduce(union);
  return (all.w / Math.max(1, letters)) * perWindow;
}

/** Outline i depends on deps[i]: every LOWER outline (j < i) it overlaps, which must be placed before it. */
export function dependencies(outlines: readonly Outline[], overlaps: Overlaps): number[][] {
  const ps: OutlinePiece[] = outlines.map((o, i) => ({ ...o, id: `o${i}` }));
  return ps.map((p, i) => ps.slice(0, i).flatMap((q, j) => (overlaps(q, p) ? [j] : [])));
}

/** The unplaced outlines whose every dependency is placed, lowest first. */
export function readyOutlines(deps: readonly (readonly number[])[], placed: ReadonlySet<number>): number[] {
  return deps.flatMap((d, i) => (!placed.has(i) && d.every((j) => placed.has(j)) ? [i] : []));
}

/**
 * The placed outlines are closed downward: no unplaced outline is a dependency of a placed one. Only then is the plan
 * correct by construction for every within-batch order (see the file comment); otherwise the pieces below a placed one have
 * to go on top of it and the safety-net prompts show.
 */
export function downwardClosed(deps: readonly (readonly number[])[], placed: ReadonlySet<number>): boolean {
  return [...placed].every((i) => (deps[i] ?? []).every((j) => placed.has(j)));
}

export interface BatchOptions {
  /** At most this many outlines per batch (default BATCH_MAX). */
  max?: number;
  /** An outline's bounds on the board (its real outline's), board units. */
  boxOf: (o: Outline) => Rect;
  /** Board units (`localitySpan`): a batch's outlines together fit a square this size (its first outline alone may be larger). */
  span: number;
  /** Extra cost per unit of a rightward step to the next batch's first outline (default BATCH_RIGHT_COST). */
  rightCost?: number;
}

const centreOf = (list: readonly Outline[], ids: readonly number[]) => ({
  x: ids.reduce((s, i) => s + list[i].x, 0) / ids.length,
  y: ids.reduce((s, i) => s + list[i].y, 0) / ids.length,
});

/**
 * The word's batches, in the order they are built: outline indices, each batch's lowest first. `placed`: the outlines
 * already filled when the word starts (the c): they form batch 0 on their own (already done; it shows again only if one of
 * them is taken away). Every outline is in exactly one batch; no batch is empty. Deterministic.
 */
export function planBatches(outlines: readonly Outline[], overlaps: Overlaps, placed: readonly number[], opt: BatchOptions): number[][] {
  const n = outlines.length;
  const max = Math.max(1, opt.max ?? BATCH_MAX);
  const deps = dependencies(outlines, overlaps);
  const ov = (i: number, j: number) => deps[Math.max(i, j)].includes(Math.min(i, j));
  const boxes = outlines.map((o) => opt.boxOf(o));
  const done = new Set(placed.filter((i) => Number.isInteger(i) && i >= 0 && i < n));
  const out: number[][] = done.size ? [[...done].sort((a, b) => a - b)] : [];
  // Where the last batch started (its first outline), or, before the first batch: the c, or (nothing placed) the word's left edge, level with its middle.
  let anchor = done.size
    ? centreOf(outlines, [...done])
    : { x: Math.min(...outlines.map((o) => o.x)), y: outlines.reduce((s, o) => s + o.y, 0) / Math.max(1, n) };
  const cost = (i: number) => {
    const dx = outlines[i].x - anchor.x, dy = outlines[i].y - anchor.y;
    return Math.hypot(dx, dy) + (opt.rightCost ?? BATCH_RIGHT_COST) * Math.max(0, dx);
  };
  const dist = (i: number, p: { x: number; y: number }) => Math.hypot(outlines[i].x - p.x, outlines[i].y - p.y);
  while (done.size < n) {
    const ready = readyOutlines(deps, done);
    if (!ready.length) break; // cannot happen: the lowest unplaced outline is always ready
    const seed = ready.reduce((a, b) => (cost(b) < cost(a) - 1e-9 ? b : a));
    const batch = [seed];
    let box = boxes[seed];
    for (;;) {
      if (batch.length >= max) break;
      const c = centreOf(outlines, batch);
      const fits = ready.filter((i) => {
        if (batch.includes(i) || batch.some((j) => ov(i, j))) return false;
        const u = union(box, boxes[i]);
        return u.w <= opt.span && u.h <= opt.span;
      });
      if (!fits.length) break;
      const pick = fits.reduce((a, b) => (dist(b, c) < dist(a, c) - 1e-9 ? b : a));
      batch.push(pick);
      box = union(box, boxes[pick]);
    }
    batch.sort((a, b) => a - b);
    for (const i of batch) done.add(i);
    out.push(batch);
    anchor = { x: outlines[seed].x, y: outlines[seed].y };
  }
  // Defensive: anything left (it cannot be) goes last, one per batch, lowest first.
  for (let i = 0; i < n; i++) if (!done.has(i)) out.push([i]);
  return out;
}

/** The batch each outline is in (index per outline). */
export function batchOf(batches: readonly (readonly number[])[], n: number): number[] {
  const of = new Array<number>(n).fill(-1);
  batches.forEach((b, k) => b.forEach((i) => (of[i] = k)));
  return of;
}

/**
 * Whether `plan` is a valid batch plan for `outlines` with `placed` already on the board (the c): every outline exactly once,
 * batch 0 is exactly `placed` (when any), and every later batch is non-empty, at most `max` long, ready when it starts (every
 * lower outline it overlaps is in an earlier batch) with no two outlines overlapping. Returns null when valid, else why not.
 * These are the rules the correctness proof above needs; used to check a curated plan (guide-plans.ts) before it is used.
 * Same-colour pairs (v1.6.2, was the curated "order-free pairs" of v1.5.0): such a pair is no dependency and may overlap
 * inside a batch; a batch whose outlines are ALL pairwise the same colour may exceed `max`. Every other pair keeps the rules.
 */
export function validatePlan(
  outlines: readonly Outline[], overlaps: Overlaps, placed: readonly number[], plan: readonly (readonly number[])[], max = BATCH_MAX,
): string | null {
  const n = outlines.length;
  // A same-colour pair imposes no order (stacking.ts `sameColour`).
  const isFree = (i: number, j: number) => sameColour(outlines[i], outlines[j]);
  const deps = dependencies(outlines, overlaps);
  // The dependencies that count: a same-colour pair imposes no order.
  const need = deps.map((d, i) => d.filter((j) => !isFree(i, j)));
  const seen = new Set<number>();
  for (const b of plan) for (const i of b) {
    if (!Number.isInteger(i) || i < 0 || i >= n) return `outline ${i} does not exist`;
    if (seen.has(i)) return `outline ${i} appears twice`;
    seen.add(i);
  }
  if (seen.size !== n) return 'not every outline is in the plan';
  if (placed.length && !downwardClosed(deps, new Set(placed))) return 'the placed outlines are not closed downward';
  const done = new Set<number>();
  for (let k = 0; k < plan.length; k++) {
    const b = plan[k];
    if (!b.length) return `batch ${k} is empty`;
    if (k === 0 && placed.length) {
      if (b.length !== placed.length || !placed.every((i) => b.includes(i))) return 'batch 0 is not the placed outlines';
    } else {
      const allFree = b.every((i) => b.every((j) => i === j || isFree(i, j)));
      if (b.length > max && !allFree) return `batch ${k} has more than ${max} outlines`;
      for (const i of b) if (!need[i].every((j) => done.has(j))) return `batch ${k}: outline ${i} is not ready`;
      for (const i of b) for (const j of b) if (i < j && deps[j].includes(i) && !isFree(i, j)) return `batch ${k}: outlines ${i} and ${j} overlap`;
    }
    for (const i of b) done.add(i);
  }
  return null;
}
