import { activeIndices, clickIn, filledBy, needsTurning, type ClickResult, type Outline, type OutlinePiece, type SizeOf } from './outline';

/**
 * The onboarding guide (v2): the visitor builds Edward's "c" (`lower-c-1`) piece by piece onto dotted **outlines**, then may
 * be guided through the whole word "create" (`word-create-1`). Pure, no DOM: the step state machine, the "don't show again"
 * storage rule and the callout placement. The component (main.ts) feeds it the board and draws the outlines and the callout.
 *
 * 1. outline: the black oval (the c's first piece).            Done when it is filled (a piece sits exactly on it).
 * 2. outline: the white oval, lying on the black oval.          Done when it is filled.
 * 3. outline: the wedge, at its angle. 3a "drag it into place"; 3b (a wedge is close in position but needs turning) "turn it".
 * 4. no outline. "That's a c." Guide me (only when word-create-1 exists) or Clear for free play.
 * 5. outlines: the whole word, every piece at once, filled in any order. Progress "N of M". Same turning hint as 3b.
 * 6. no outline. "You made "create"." Start fresh or Keep it.
 *
 * Which step shows is DERIVED from the board every time (`observeGuide`): an outline is filled when a piece of its shape
 * sits exactly on it. So deleting or moving a clicked-in piece re-shows its outline, and undo/redo keep the guide in step
 * with the board. The only thing that is never undone is a button the visitor chose: after Guide me the guide stays on
 * the word (steps 5 and 6) whatever happens to the board.
 *
 * Click-in (`guideClickIn`): only while a step with outlines is showing, a released piece of the right shape close to an
 * active outline clicks exactly into it (see outline.ts for the tolerance). With the guide not running, it is always null.
 *
 * 0. (v1.2.1) Only when the guide starts on a board that already has pieces: "Start on a clean fridge?" Clear and start
 *    (the board is cleared as ONE undoable step, then step 1 on a blank board) or Keep my pieces (their pieces stay; the
 *    c's outlines, and later the word's, go in EMPTY board beside them: `besideSpot`, framed by `frameBeside`).
 *
 * The visitor's own pieces: the pieces on the board when step 0 was answered are THEIRS (`theirs`), and so is anything they
 * add or move during the guide that is not clicked into an outline. The guide only ever removes GUIDE-BUILT pieces
 * (`built`: clicked into an outline, or placed by Next) still sitting on an outline (`guideBuilt`). After Keep (or when any
 * of their pieces is back on the board, e.g. after undoing Clear and start) the guide's clears are scoped to those
 * (`guideClearPlan`); on a blank start they clear the whole board as before.
 */

export const GUIDE_STORAGE_KEY = 'fridgeface:guide:v2';
export const GUIDE_OFF_VALUE = 'off';
/** A step not completed after this long shows a Next button, ms. */
export const GUIDE_NEXT_MS = 10_000;
/** The letter the guide builds, and the word it offers next (suggestion files lower-c-1.json and word-create-1.json). */
export const GUIDE_LETTER = { char: 'c', variant: 1 } as const;
export const GUIDE_WORD = { text: 'create', variant: 1 } as const;

/** Edward's approved copy v2 (creative/personal-brand/working/fridgeface/docs/guide-copy.md), word for word. */
export const GUIDE_COPY = {
  step0: 'Start on a clean fridge?',
  clearStart: 'Clear and start',
  keepMine: 'Keep my pieces',
  step1: 'Drag the black oval onto the fridge.',
  step2: 'Now drag the white oval onto the black one.',
  step3a: 'Drag the wedge into place.',
  step3b: 'Now turn it with the round handle to fit.',
  /** Touch devices: one sentence. */
  step3bTouch: 'Now turn it with the round handle to fit, or twist with two fingers.',
  step4: "That's a c.",
  step4Ask: 'Want to spell "create" next?',
  guideMe: 'Guide me',
  clearFree: 'Clear for free play',
  step5: 'Fill in the outlines to spell "create".',
  progress: (done: number, total: number) => `${done} of ${total}`,
  step6: 'You made "create". Now try your own name.',
  startFresh: 'Start fresh',
  keepIt: 'Keep it',
  skip: 'Skip',
  dontShow: "Don't show again",
  next: 'Next',
  replay: 'Show guide',
} as const;

export type GuideStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/**
 * 'ask': step 0 (the board already had pieces). 'c': steps 1 to 4 (the letter). 'word': steps 5 and 6, after the visitor
 * chose Guide me (never goes back). null: the guide is not running.
 */
export type GuidePhase = 'ask' | 'c' | 'word';

export interface GuideWorld {
  /** The composition, in stacking order (bottom first). */
  pieces: readonly OutlinePiece[];
  sizeOf: SizeOf;
}

/** `phase` null: the guide is not running (`step` 0). `phase` 'ask' is step 0 showing. */
export interface GuideState {
  step: GuideStep;
  phase: GuidePhase | null;
  /** The c's outlines (kept through the word phase, so the c's pieces are still known as guide-built). */
  letter: readonly Outline[];
  /** Keep my pieces was chosen at step 0. */
  kept: boolean;
  /** The visitor's pieces when step 0 was answered (kept, or cleared by Clear and start): never removed by the guide. */
  theirs: readonly string[];
  /** Pieces the guide built: clicked into an outline, or placed by Next (never one of `theirs`). */
  built: readonly string[];
  /** Every outline of the current phase, in the suggestion's stacking order (the c's 3, or the whole word). */
  outlines: readonly Outline[];
  /** Per outline: the piece sitting exactly on it, or null. */
  filled: readonly (string | null)[];
  /** A piece close to an active outline of its shape but at the wrong angle (step 3b, or the same hint in step 5), or null. */
  turn: string | null;
}

const NONE = Object.freeze([]) as readonly never[];
export const GUIDE_IDLE: GuideState = Object.freeze({
  step: 0, phase: null, letter: NONE, kept: false, theirs: NONE, built: NONE, outlines: NONE, filled: NONE, turn: null,
}) as GuideState;

/** Is the guide running (step 0's question included)? */
export const guideRunning = (s: GuideState): boolean => s.phase !== null;

/** Step 0: the guide starts on a board that already has pieces. */
export function askGuide(): GuideState {
  return { ...GUIDE_IDLE, phase: 'ask' };
}

/** The outlines showing (and accepting a piece) in this state: one at a time in steps 1 to 3, every unfilled one in step 5. */
export function activeOutlines(s: GuideState): number[] {
  if (s.phase === 'c' && s.step >= 1 && s.step <= 3) {
    const i = s.filled.findIndex((f) => !f);
    return i < 0 ? [] : [i];
  }
  if (s.phase === 'word' && s.step === 5) return activeIndices(s.filled);
  return [];
}

type Carry = Pick<GuideState, 'letter' | 'kept' | 'theirs' | 'built'>;
const carry = (s: GuideState): Carry => ({ letter: s.letter, kept: s.kept, theirs: s.theirs, built: s.built });

function derive(phase: 'c' | 'word', outlines: readonly Outline[], w: GuideWorld, c: Carry): GuideState {
  const filled = filledBy(outlines, w.pieces);
  const first = filled.findIndex((f) => !f);
  const step: GuideStep = phase === 'c' ? (first < 0 ? 4 : (Math.min(first + 1, 3) as GuideStep)) : first < 0 ? 6 : 5;
  const s: GuideState = { ...c, step, phase, outlines, filled, turn: null };
  const active = activeOutlines(s);
  // The turning hint: in step 3 (the wedge) and step 5 (any piece of the word).
  const turn = step === 3 || step === 5 ? needsTurning(outlines, active, filled, w.pieces, w.sizeOf) : null;
  return { ...s, turn };
}

const same = (a: GuideState, b: GuideState) =>
  a.step === b.step && a.phase === b.phase && a.outlines === b.outlines && a.turn === b.turn && a.filled.length === b.filled.length && a.filled.every((f, i) => f === b.filled[i])
  && a.letter === b.letter && a.kept === b.kept && a.theirs === b.theirs && a.built === b.built;

/**
 * Start (or replay) at step 1 with the c's outlines (already placed on the board). An empty list cannot start it.
 * `from`: step 0's answer, carried on (`kept`, `theirs`); a fresh start has neither.
 */
export function startGuide(cOutlines: readonly Outline[], w: GuideWorld, from: { kept?: boolean; theirs?: readonly string[] } = {}): GuideState {
  if (!cOutlines.length) return GUIDE_IDLE;
  return derive('c', cOutlines, w, { letter: cOutlines, kept: !!from.kept, theirs: from.theirs ?? NONE, built: NONE });
}

/**
 * Step 0's answer. 'clear' (Clear and start): the caller clears the board (one undoable step) and the c starts on the blank
 * board. 'keep' (Keep my pieces): the c starts with its outlines beside their work. Either way the pieces on the board now
 * are THEIRS. Only from step 0.
 */
export function answerAsk(s: GuideState, answer: 'clear' | 'keep', cOutlines: readonly Outline[], w: GuideWorld, theirs: readonly string[]): GuideState {
  if (s.phase !== 'ask') return s;
  return startGuide(cOutlines, w, { kept: answer === 'keep', theirs: [...theirs] });
}

/** Move the c's outlines (nothing filled yet: e.g. their pieces came back on an undo and the outlines sat on them). */
export function moveLetter(s: GuideState, cOutlines: readonly Outline[], w: GuideWorld): GuideState {
  if (s.phase !== 'c' || s.filled.some(Boolean) || !cOutlines.length) return s;
  return derive('c', cOutlines, w, { ...carry(s), letter: cOutlines });
}

/** Pieces that clicked into an outline (or that Next placed): guide-built, unless they are the visitor's own. */
export function recordBuilt(s: GuideState, ids: readonly string[]): GuideState {
  if (!guideRunning(s)) return s;
  const add = ids.filter((id) => !s.theirs.includes(id) && !s.built.includes(id));
  return add.length ? { ...s, built: [...s.built, ...add] } : s;
}

/**
 * The guide-built pieces on the board now: built by the guide AND still sitting on one of its outlines (the c's or the
 * word's). A built piece the visitor moved off its outline is theirs now.
 */
export function guideBuilt(s: GuideState, pieces: readonly OutlinePiece[]): string[] {
  if (!s.built.length) return [];
  const built = new Set(s.built);
  const on = new Set([...filledBy(s.letter, pieces), ...(s.phase === 'word' ? filledBy(s.outlines, pieces) : [])].filter((id): id is string => !!id));
  return pieces.filter((p) => built.has(p.id) && on.has(p.id)).map((p) => p.id);
}

/**
 * What the guide's clears remove (Guide me, Clear for free play, Start fresh): only the guide-built pieces once the visitor
 * kept their pieces (or any of theirs is on the board again, e.g. after undoing Clear and start); otherwise, on a blank
 * start, the whole board as before.
 */
export function guideClearPlan(s: GuideState, pieces: readonly OutlinePiece[]): { all: true } | { all: false; ids: string[] } {
  const theirs = new Set(s.theirs);
  if (!s.kept && !pieces.some((p) => theirs.has(p.id))) return { all: true };
  return { all: false, ids: guideBuilt(s, pieces) };
}

/**
 * The board changed (outside a gesture, after a click-in, a load, an undo or a redo): re-read which outlines are filled.
 * Returns the same object when nothing changed.
 */
export function observeGuide(s: GuideState, w: GuideWorld): GuideState {
  if (!s.step || !s.phase || s.phase === 'ask') return s;
  const next = derive(s.phase, s.outlines, w, carry(s));
  return same(s, next) ? s : next;
}

/** Step 4's Guide me: the word's outlines (already placed). Only from step 4. */
export function chooseWord(s: GuideState, wordOutlines: readonly Outline[], w: GuideWorld): GuideState {
  if (s.step !== 4 || !wordOutlines.length) return s;
  return derive('word', wordOutlines, w, carry(s));
}

/** Skip, Don't show again, Clear for free play, Start fresh, Keep it (and step 0's Skip / Don't show again). */
export function endGuide(): GuideState {
  return GUIDE_IDLE;
}

/** Step 5's progress: outlines filled, of all of them. */
export function guideProgress(s: GuideState): { done: number; total: number } {
  return { done: s.filled.filter(Boolean).length, total: s.filled.length };
}

/** A released piece (or several): what clicks into the active outlines, if anything. Always null when the guide is not running. */
export function guideClickIn(s: GuideState, w: GuideWorld, released: readonly string[]): ClickResult | null {
  if (!s.step) return null;
  return clickIn(s.outlines, activeOutlines(s), w.pieces, released, w.sizeOf);
}

/** Next (shown when stuck): the outline it fills for the visitor (the lowest active one), or null on steps without outlines. */
export function nextOutline(s: GuideState): number | null {
  return activeOutlines(s)[0] ?? null;
}

// ---- outlines beside the visitor's work (Keep my pieces) --------------------------------------------------------

export type Side = 'right' | 'below' | 'left' | 'above';
/** Keep my pieces: the sides tried for the outlines, in order of preference. */
export const BESIDE_ORDER: readonly Side[] = ['right', 'below', 'left', 'above'];

/** Where an area of `size` sits on `side` of `work`, `margin` clear of it, centred on it along the other axis. */
export function besideRect(work: Rect, size: { w: number; h: number }, side: Side, margin: number): Rect {
  const cx = work.x + work.w / 2 - size.w / 2, cy = work.y + work.h / 2 - size.h / 2;
  if (side === 'right') return { x: work.x + work.w + margin, y: cy, w: size.w, h: size.h };
  if (side === 'left') return { x: work.x - margin - size.w, y: cy, w: size.w, h: size.h };
  if (side === 'below') return { x: cx, y: work.y + work.h + margin, w: size.w, h: size.h };
  return { x: cx, y: work.y - margin - size.h, w: size.w, h: size.h };
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

/** The zoom at which `r` (board units) fits a view of `view` (screen units) with `pad` on every side. */
export function fitZoom(r: Rect, view: { w: number; h: number }, pad: number): number {
  return Math.min(Math.max(1, view.w - 2 * pad) / Math.max(1, r.w), Math.max(1, view.h - 2 * pad) / Math.max(1, r.h));
}

export interface BesideOptions {
  /** Board units of open board kept between their work and the outlines. */
  margin: number;
  /** The view the result is framed in (screen units) and its padding: decides which sides fit it well. */
  view: { w: number; h: number };
  pad: number;
  /** The zoom at which the outlines' targets are big enough; a side whose framing needs less is passed over if another fits. */
  minZoom: number;
  /** Other board to keep clear of (e.g. every piece's own bounds), beyond the work's bounds themselves. */
  avoid?: readonly Rect[];
  order?: readonly Side[];
}

/**
 * Keep my pieces: a spot of EMPTY board for an area of `size` beside the visitor's `work` (the bounds of their whole
 * composition), `margin` clear of it, never overlapping it (nor `avoid`). Sides are tried right, then below, then left,
 * then above: the first whose framing of work AND outlines together keeps the targets big enough (`minZoom`) wins.
 * When none does (a long composition on a narrow phone), the side that frames largest wins (ties: the order).
 */
export function besideSpot(work: Rect, size: { w: number; h: number }, o: BesideOptions): { side: Side; rect: Rect; zoom: number } {
  const order = o.order ?? BESIDE_ORDER;
  let best: { side: Side; rect: Rect; zoom: number } | null = null;
  for (const side of order) {
    let rect = besideRect(work, size, side, o.margin);
    // Step further out past anything else in the way (on that side, away from the work).
    for (let i = 0; i < 32; i++) {
      const hit = (o.avoid ?? []).find((q) => rectsOverlap(grow(rect, o.margin / 2), q));
      if (!hit) break;
      const m = o.margin;
      if (side === 'right') rect = { ...rect, x: hit.x + hit.w + m };
      else if (side === 'left') rect = { ...rect, x: hit.x - m - rect.w };
      else if (side === 'below') rect = { ...rect, y: hit.y + hit.h + m };
      else rect = { ...rect, y: hit.y - m - rect.h };
    }
    const zoom = fitZoom(union(work, rect), o.view, o.pad);
    if (zoom >= o.minZoom) return { side, rect, zoom };
    if (!best || zoom > best.zoom + 1e-9) best = { side, rect, zoom };
  }
  return best!;
}

/**
 * Frame their work and the outlines: both in full when that keeps the targets big enough (`minZoom`, capped by `maxZoom`);
 * otherwise the outlines win. Rule: zoom in only as far as the targets need (or until the outlines alone fill the view),
 * then centre on the whole and slide just enough to bring the outlines fully into view, so the outlines hug the far edge
 * and as much of their work as fits stays in sight on the near side (they can see it is untouched, and the targets stay
 * big enough to see and press on a phone). Returns a camera for `view` (screen units, offset by `view.x`/`view.y`).
 */
export function frameBeside(
  work: Rect | null, outlines: Rect, view: Rect, pad: number, minZoom: number, maxZoom: number,
): { x: number; y: number; zoom: number; both: boolean } {
  const all = work ? union(work, outlines) : outlines;
  const zAll = fitZoom(all, view, pad);
  const zOut = fitZoom(outlines, view, pad);
  const both = zAll >= Math.min(minZoom, zOut) - 1e-9;
  const zoom = Math.min(maxZoom, both ? zAll : Math.max(zAll, Math.min(minZoom, zOut)));
  // Centre on everything, then slide so the outlines are fully inside the view (less the padding).
  let x = view.x + view.w / 2 - (all.x + all.w / 2) * zoom;
  let y = view.y + view.h / 2 - (all.y + all.h / 2) * zoom;
  const fit = (lo: number, len: number, vlo: number, vlen: number, off: number) => {
    const a = lo * zoom + off, b = (lo + len) * zoom + off;
    if (b - a > vlen - 2 * pad) return vlo + vlen / 2 - (lo + len / 2) * zoom; // larger than the view: centre it
    if (a < vlo + pad) return off + (vlo + pad - a);
    if (b > vlo + vlen - pad) return off - (b - (vlo + vlen - pad));
    return off;
  };
  x = fit(outlines.x, outlines.w, view.x, view.w, x);
  y = fit(outlines.y, outlines.h, view.y, view.h, y);
  return { x, y, zoom, both };
}

// ---- when it shows -------------------------------------------------------------------------------------------

export interface GuideConditions {
  /** The host set the `no-guide` attribute. */
  disabled: boolean;
  /** Dev-only author mode. */
  authoring: boolean;
  /** "Don't show again" is stored. */
  off: boolean;
}

/** Every visit (share links included), unless disabled, authoring or turned off. A replay ignores "Don't show again". */
export function guideWanted(c: GuideConditions, replay = false): boolean {
  return !c.disabled && !c.authoring && (replay || !c.off);
}

export interface GuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** "Don't show again" is set. Any storage failure (blocked, missing, throwing) reads as not set. */
export function readGuideOff(storage: () => GuideStorage | null | undefined): boolean {
  try {
    return storage()?.getItem(GUIDE_STORAGE_KEY) === GUIDE_OFF_VALUE;
  } catch {
    return false;
  }
}

/** Store "Don't show again". Returns false when storage failed (the guide still ends for this visit). */
export function writeGuideOff(storage: () => GuideStorage | null | undefined): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(GUIDE_STORAGE_KEY, GUIDE_OFF_VALUE);
    return true;
  } catch {
    return false;
  }
}

// ---- callout placement -----------------------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
/** Where the callout sits relative to its target ('centre': no target, centred in the bounds, no arrow). */
export type CalloutSide = 'above' | 'below' | 'left' | 'right' | 'centre';
export interface CalloutPlacement {
  x: number;
  y: number;
  side: CalloutSide;
  /** Along the arrow's edge, from the callout's left (above/below) or top (left/right) edge, px. */
  arrow: number;
}

const EPS = 0.5;
export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, b: Rect) => r.x >= b.x - EPS && r.y >= b.y - EPS && r.x + r.w <= b.x + b.w + EPS && r.y + r.h <= b.y + b.h + EPS;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Positions from `lo` to `hi`, nearest to `ideal` first. */
function along(ideal: number, lo: number, hi: number, step: number): number[] {
  if (hi < lo) return [lo];
  const first = clamp(ideal, lo, hi);
  const out = [first];
  for (let d = step; first - d > lo || first + d < hi; d += step) {
    if (first + d < hi) out.push(first + d);
    if (first - d > lo) out.push(first - d);
  }
  for (const e of [lo, hi]) if (!out.includes(e)) out.push(e);
  return out;
}

/** How far the arrow can sit from the callout's corner, px. */
const ARROW_INSET = 18;

/** How many of `pieces` a rect overlaps. */
const covers = (r: Rect, pieces: readonly Rect[]) => pieces.reduce((n, q) => n + (rectsOverlap(r, q) ? 1 : 0), 0);
/** How many of `pieces` a rect covers, and how much of them (px²): lower is emptier board. */
export function coverage(r: Rect, pieces: readonly Rect[]): { n: number; a: number } {
  return { n: covers(r, pieces), a: coverArea(r, pieces) };
}

/** How much of `pieces` a rect covers, px² (the tie-break between spots covering the same number). */
const coverArea = (r: Rect, pieces: readonly Rect[]) => pieces.reduce((a, q) => {
  const w = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x), h = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y);
  return a + (w > 0 && h > 0 ? w * h : 0);
}, 0);

/**
 * The best spot on one side of the target: inside the bounds, clear of the obstacles (stepping away past them), covering
 * the fewest `pieces`, then nearest the target's centre. Strict: only where the arrow, on its edge, can sit level with
 * some part of the target (so it points AT it, not past it).
 */
function onSide(
  side: Exclude<CalloutSide, 'centre'>, size: { w: number; h: number }, t: Rect, bounds: Rect, obstacles: readonly Rect[], gap: number, strict: boolean,
  pieces: readonly Rect[],
): Rect | null {
  const vertical = side === 'above' || side === 'below';
  const ideal = vertical ? t.x + t.w / 2 - size.w / 2 : t.y + t.h / 2 - size.h / 2;
  const lo = vertical ? bounds.x : bounds.y;
  const hi = vertical ? bounds.x + bounds.w - size.w : bounds.y + bounds.h - size.h;
  const tLo = vertical ? t.x : t.y, tHi = vertical ? t.x + t.w : t.y + t.h;
  const len = vertical ? size.w : size.h;
  let best: { r: Rect; n: number; a: number; d: number } | null = null;
  for (const c of along(ideal, lo, hi, 16)) {
    if (strict && (c + len - ARROW_INSET < tLo || c + ARROW_INSET > tHi)) continue;
    let m = side === 'above' ? t.y - gap - size.h : side === 'below' ? t.y + t.h + gap : side === 'left' ? t.x - gap - size.w : t.x + t.w + gap;
    for (let i = 0; i < 16; i++) {
      const r = vertical ? { x: c, y: m, w: size.w, h: size.h } : { x: m, y: c, w: size.w, h: size.h };
      if (!inside(r, bounds)) break;
      const o = obstacles.find((q) => rectsOverlap(r, q));
      if (!o) {
        const n = covers(r, pieces), a = n ? coverArea(r, pieces) : 0, d = Math.abs(c - ideal) + Math.abs(i);
        if (!best || n < best.n || (n === best.n && (a < best.a - 1 || (Math.abs(a - best.a) <= 1 && d < best.d)))) best = { r, n, a, d };
        break;
      }
      // Step away from the target, past the obstacle.
      m = side === 'above' ? o.y - size.h - 6 : side === 'below' ? o.y + o.h + 6 : side === 'left' ? o.x - size.w - 6 : o.x + o.w + 6;
    }
    if (best && best.n === 0 && !pieces.length) break; // nothing to weigh: the nearest spot wins
  }
  return best?.r ?? null;
}

function centred(size: { w: number; h: number }, bounds: Rect, obstacles: readonly Rect[]): Rect | null {
  const xs = along(bounds.x + (bounds.w - size.w) / 2, bounds.x, bounds.x + bounds.w - size.w, 16);
  const ys = along(bounds.y + (bounds.h - size.h) / 2, bounds.y, bounds.y + bounds.h - size.h, 8);
  const cx = xs[0], cy = ys[0];
  const all: Rect[] = [];
  for (const y of ys) for (const x of xs) all.push({ x, y, w: size.w, h: size.h });
  all.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return all.find((r) => !obstacles.some((o) => rectsOverlap(r, o))) ?? null;
}

/**
 * Place a callout of `size` next to `target` (all in the same px space), fully inside `bounds`, clear of `obstacles`
 * (controls) and, where it can, `soft` (what the step would rather leave visible), never over the target. It prefers a spot
 * whose arrow is level with the target, then the one covering the fewest `pieces` (empty board over pieces; then the least
 * area of them), then the
 * side order in `prefer`, then nearness to the target's centre, stepping past obstacles. With no target, or when no side fits, it is centred in the bounds
 * (clear of the obstacles and the target where possible), with no arrow.
 */
export function placeCallout(
  size: { w: number; h: number }, target: Rect | null, bounds: Rect, obstacles: readonly Rect[],
  prefer: readonly Exclude<CalloutSide, 'centre'>[], soft: readonly Rect[] = [], pieces: readonly Rect[] = [], gap = 22,
): CalloutPlacement {
  const firm = [...obstacles, ...soft];
  if (target) {
    // First a side where the arrow points straight at the target; failing that, any side that fits; and only then one that
    // covers the `soft` rects (what the step would rather leave visible, such as the piece being turned). Within a pass, the
    // side whose best spot covers the fewest pieces wins (ties: the order of `prefer`).
    const passes: [boolean, readonly Rect[]][] = [[true, firm], [false, firm], [true, obstacles], [false, obstacles]];
    for (const [strict, obs] of passes) {
      let best: { r: Rect; side: Exclude<CalloutSide, 'centre'>; n: number; a: number } | null = null;
      for (const side of prefer) {
        const r = onSide(side, size, target, bounds, obs, gap, strict, pieces);
        if (!r) continue;
        const n = covers(r, pieces), a = coverArea(r, pieces);
        if (!best || n < best.n || (n === best.n && a < best.a - 1)) best = { r, side, n, a };
      }
      if (!best) continue;
      const { r, side } = best;
      const vertical = side === 'above' || side === 'below';
      const arrow = vertical
        ? clamp(target.x + target.w / 2 - r.x, ARROW_INSET, size.w - ARROW_INSET)
        : clamp(target.y + target.h / 2 - r.y, ARROW_INSET, size.h - ARROW_INSET);
      return { x: r.x, y: r.y, side, arrow };
    }
  }
  const t = target ? [target] : [];
  const r = centred(size, bounds, [...firm, ...t]) ?? centred(size, bounds, [...obstacles, ...t]) ?? centred(size, bounds, t)
    ?? { x: clamp(bounds.x + (bounds.w - size.w) / 2, bounds.x, bounds.x + bounds.w), y: clamp(bounds.y + (bounds.h - size.h) / 2, bounds.y, bounds.y + bounds.h) };
  return { x: r.x, y: r.y, side: 'centre', arrow: 0 };
}
