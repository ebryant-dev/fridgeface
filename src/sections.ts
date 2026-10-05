import { rotatedBounds } from './camera';
import type { Outline, ShapeFrame } from './outline';

/**
 * Sections: on phones the guided word is filled one SECTION at a time (pure, no DOM). A composition does not record which
 * pieces belong to which letter (a ligature serves two letters at once), so the word's pieces are split automatically.
 *
 * The algorithm, and why:
 * 1. Each piece is placed by the centre of its rotated bounds along x (where the eye sees it), ties by stacking index.
 *    Sorting by that gives a left-to-right reading order, so every section is a contiguous run of it: sections never
 *    interleave and the visitor moves steadily along the word.
 * 2. The cuts are chosen by dynamic programming over every possible set of cut points (n is small: a word is at most a few
 *    dozen pieces), minimising  imbalance - gap reward:
 *      - imbalance: the sum over sections of ((size - n/K) / (n/K))^2, so the piece counts stay close to even;
 *      - gap reward: GAP_WEIGHT * min(gap / median gap, GAP_CAP) for each cut, so cuts land in the widest horizontal gaps
 *        (the natural breaks between letters) rather than through a cluster. The cap stops one huge gap from buying a
 *        badly unbalanced split. Exhaustive DP is deterministic and always finds the best split for this cost.
 * 3. K is the text's length (one section per letter, roughly). Extra non-letter parts (a flower beside the word) simply
 *    fall into the nearest section by position. One extra section (K + 1) is allowed only when a CLEAR gap separates
 *    them: the largest gap is at least CLEAR_GAP times the median gap AND CLEAR_LEAD times the next largest (one gap that
 *    stands out, not several similar letter gaps), and the K + 1 split actually cuts there.
 */

/** A cut's reward per median gap (balanced against the imbalance term, which is about 0 to 1 per section). */
export const GAP_WEIGHT = 0.2;
/** A gap counts for at most this many median gaps. */
export const GAP_CAP = 4;
/** A gap at least this many median gaps wide is a clear separation (one extra section is allowed at it). */
export const CLEAR_GAP = 3.5;
/** ...and at least this many times the second largest gap. */
export const CLEAR_LEAD = 1.5;

/** The centre x of each piece's rotated bounds, board units (its own x when the shape is unknown). */
export function centreXs(pieces: readonly Outline[], shapeOf: (id: string) => ShapeFrame | undefined): number[] {
  return pieces.map((p) => {
    const b = rotatedBounds([p], shapeOf);
    return b ? b.x + b.w / 2 : p.x;
  });
}

const median = (v: readonly number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The best split of `n` sorted items into `k` contiguous runs for the cost above: the cut positions (after item j). */
function bestCuts(gaps: readonly number[], n: number, k: number, unit: number): { cuts: number[]; cost: number } {
  const t = n / k;
  const imb = (size: number) => ((size - t) / t) ** 2;
  const reward = (j: number) => GAP_WEIGHT * Math.min(gaps[j] / unit, GAP_CAP);
  // f[s][i]: the least cost of splitting the first i items into s runs (the s-th run ends at item i - 1).
  const f: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  f[0][0] = 0;
  for (let s = 1; s <= k; s++) {
    for (let i = s; i <= n - (k - s); i++) {
      for (let j = s - 1; j < i; j++) {
        if (f[s - 1][j] === Infinity) continue;
        // A run from item j to i - 1; the cut before it (after item j - 1) earns gap j - 1's reward.
        const c = f[s - 1][j] + imb(i - j) - (j > 0 ? reward(j - 1) : 0);
        if (c < f[s][i] - 1e-12) {
          f[s][i] = c;
          from[s][i] = j;
        }
      }
    }
  }
  const cuts: number[] = [];
  for (let s = k, i = n; s > 0; s--) {
    const j = from[s][i];
    if (j > 0) cuts.unshift(j - 1);
    i = j;
  }
  return { cuts, cost: f[k][n] };
}

/**
 * Split a word's pieces into about `count` sections (see the algorithm above). Returns the pieces' indices per section,
 * sections left to right, each section's indices in left-to-right order. Every piece is in exactly one section; no section
 * is empty. Deterministic.
 */
export function splitSections(pieces: readonly Outline[], shapeOf: (id: string) => ShapeFrame | undefined, count: number): number[][] {
  const n = pieces.length;
  if (!n) return [];
  const xs = centreXs(pieces, shapeOf);
  const order = pieces.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  const k = Math.max(1, Math.min(n, Math.round(count) || 1));
  const gaps = order.slice(1).map((id, j) => xs[id] - xs[order[j]]);
  const unit = median(gaps.filter((g) => g > 0)) || 1;
  let { cuts } = bestCuts(gaps, n, k, unit);
  if (k < n && gaps.length) {
    const sorted = [...gaps].sort((a, b) => b - a);
    const max = sorted[0];
    const at = gaps.indexOf(max);
    if (max >= CLEAR_GAP * unit && max >= CLEAR_LEAD * (sorted[1] ?? 0)) {
      const more = bestCuts(gaps, n, k + 1, unit);
      if (more.cuts.includes(at)) cuts = more.cuts;
    }
  }
  const out: number[][] = [];
  let start = 0;
  for (const c of [...cuts, n - 1]) {
    out.push(order.slice(start, c + 1));
    start = c + 1;
  }
  return out;
}

/** The section each piece is in (index per piece). */
export function sectionOf(sections: readonly (readonly number[])[], n: number): number[] {
  const of = new Array<number>(n).fill(-1);
  sections.forEach((s, k) => s.forEach((i) => (of[i] = k)));
  return of;
}

/** Phones, the word by sections: the view is about this many letter-sections wide (the current one and a neighbour). */
export const SECTION_LETTERS_IN_VIEW = 2;

/**
 * The zoom at which a view `viewWidth` wide (screen units) spans SECTION_LETTERS_IN_VIEW average sections, given every
 * section's width in board units. The AVERAGE (not the current section's own width) keeps the scale steady from one
 * section to the next, so the glide is mostly a pan; a wide section (an "a") and a narrow one (an "r") both show with a
 * neighbour. Pure. 0 when there is nothing to measure.
 */
export function lettersZoom(viewWidth: number, sectionWidths: readonly number[], letters = SECTION_LETTERS_IN_VIEW): number {
  const ws = sectionWidths.filter((w) => w > 0);
  if (!ws.length || !(viewWidth > 0)) return 0;
  return viewWidth / (letters * (ws.reduce((a, b) => a + b, 0) / ws.length));
}

/**
 * Where the camera's x goes (screen = board * zoom + result) to frame the current section [cur] (board x range) with the
 * built section before it [prev] (or null) as context: the pair is centred on `view` (a screen x range) where it fits, then
 * the current section is kept inside `reg` (the screen x range clear of the callout), `pad` from its edges. A current
 * section wider than `reg` is centred in it. Pure.
 */
export function sectionOffsetX(cur: readonly [number, number], prev: readonly [number, number] | null, zoom: number, view: readonly [number, number], reg: readonly [number, number], pad: number): number {
  const lo = prev ? Math.min(prev[0], cur[0]) : cur[0], hi = prev ? Math.max(prev[1], cur[1]) : cur[1];
  const unionW = (hi - lo) * zoom;
  let off = (view[0] + view[1]) / 2 - ((lo + hi) / 2) * zoom;
  if (prev && unionW > view[1] - view[0]) off = view[1] - pad - hi * zoom; // the pair does not fit: keep the current section's far edge in
  const a = cur[0] * zoom + off, b = cur[1] * zoom + off;
  const rlo = reg[0] + pad, rhi = reg[1] - pad;
  if (b - a >= rhi - rlo) return (reg[0] + reg[1]) / 2 - ((cur[0] + cur[1]) / 2) * zoom;
  if (a < rlo) off += rlo - a;
  else if (b > rhi) off -= b - rhi;
  return off;
}
