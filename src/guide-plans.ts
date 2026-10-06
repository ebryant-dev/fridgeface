import { validatePlan } from './batches';
import type { Outline } from './outline';
import type { FreePairs, Overlaps } from './stacking';

/**
 * Curated batch plans (v1.4.2): for a word whose automatic plan (`planBatches`) Edward has tuned by hand, the plan he chose.
 * A curated plan is keyed to the word's CONTENT (a hash of its pieces, `contentKey`), not its name: if the word is edited, the
 * key no longer matches and the automatic planner takes over. Before a curated plan is used it is validated with the same
 * rules the correctness proof (batches.ts) needs (`validatePlan`); a plan that fails is not used (one `console.warn`).
 */
interface Curated {
  /** Content key of the word (`contentKey`). */
  key: string;
  /** The whole plan, batch 0 first: the pieces already placed at Guide me (the c). */
  plan: readonly (readonly number[])[];
  /**
   * Order-free pairs (v1.5.0): outline pairs whose relative stacking order does not matter for this word. The stacking check
   * ignores them (never a prompt), and a batch may hold them overlapping (validatePlan; see batches.ts for the proof).
   */
  free?: FreePairs;
  /** Why this plan (for the next reader). */
  note: string;
}

/** Every pair of `ids` (each once, lower index first): a group whose members' order among themselves does not matter. */
export function allPairs(ids: readonly number[]): [number, number][] {
  const s = [...ids].sort((a, b) => a - b);
  return s.flatMap((a, k) => s.slice(k + 1).map((b): [number, number] => [a, b]));
}

/**
 * `word-create-1` (32 pieces; the c is outlines 0 to 2). The automatic plan, except:
 * - v1.4.2: the e's white oval (9) is alone and the t's stem (16) comes up with the e's black stem and wedge (10, 11), as
 *   Edward asked ([9,16] then [10,11] by default).
 * - v1.5.0: the FLOWER's five petals (the black ovals 25 to 29, found by geometry: the positive rounds the flower's white
 *   centre 30 overlaps) are ORDER-FREE among themselves (Edward: petal-on-petal stacking order does not matter), so they come
 *   up as ONE batch of five, placeable in any order though they overlap; the white centre (30) sits on top of every petal,
 *   so it comes in the batch after them, with the flower's stem (31, which overlaps petals 28 and 29 and follows the normal
 *   rules). The automatic plan had them as [21,25], [23,26], [27,28], [29], [30,31].
 */
const PETALS = [25, 26, 27, 28, 29];

export const CURATED: readonly Curated[] = [
  {
    key: 'ff1-576cf0f5',
    plan: [
      [0, 1, 2], [3], [4, 5], [6], [7, 8], [9], [10, 11, 16], [12, 17, 18], [13, 19], [14], [15, 20, 22], [24], [21], [23],
      PETALS, [30, 31],
    ],
    free: allPairs(PETALS),
    note: 'create: [9], [10,11,16] instead of [9,16], [10,11]; the five petals order-free in one batch, then the centre',
  },
];

/**
 * A key for a word's content: FNV-1a over each piece's shape, position relative to the first piece (the word is placed at
 * the c, so only the shape of the word matters, rounded to 0.1) and rotation (modulo 360, rounded to 0.1), in order.
 */
export function contentKey(outlines: readonly Outline[]): string {
  if (!outlines.length) return 'ff1-empty';
  const r = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const turn = (v: number) => r(((v % 360) + 360) % 360 % 360);
  const text = outlines.map((o) => `${o.shapeId}:${r(o.x - outlines[0].x)}:${r(o.y - outlines[0].y)}:${turn(o.rotation)}`).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `ff1-${h.toString(16).padStart(8, '0')}`;
}

let warned = false;

/** A curated plan in effect: its batches, and its order-free pairs (none: an empty list). */
export interface CuratedResult {
  batches: number[][];
  free: [number, number][];
}

/**
 * The curated plan for this word, or null (the automatic planner then runs): no curated plan has this content, the placed
 * outlines are not the plan's batch 0, or the plan fails validation (then once, `console.warn`).
 */
export function curatedPlan(outlines: readonly Outline[], overlaps: Overlaps, placed: readonly number[]): CuratedResult | null {
  const key = contentKey(outlines);
  const c = CURATED.find((q) => q.key === key);
  if (!c) return null;
  const first = c.plan[0];
  if (placed.length !== first.length || !first.every((i) => placed.includes(i))) return null; // not started from its c
  const why = validatePlan(outlines, overlaps, placed, c.plan, undefined, c.free ?? []);
  if (why) {
    if (!warned) {
      warned = true;
      console.warn(`Fridgeface: the curated batch plan (${c.note}) is not valid (${why}); using the automatic plan.`);
    }
    return null;
  }
  return { batches: c.plan.map((b) => [...b]), free: (c.free ?? []).map(([a, b]): [number, number] => [a, b]) };
}

/** Tests: let the one-time warning show again. */
export function resetCuratedWarning() {
  warned = false;
}
