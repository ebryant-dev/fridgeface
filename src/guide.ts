import { rotatedBounds } from './camera';
import { normalise } from './rotation';
import {
  FILL_ANGLE_EPS, FILL_POS_EPS, activeIndices, angleGap, clickIn, filledBy, needsTurning, outlinesAt, type ClickResult, type Outline, type OutlinePiece,
  type ShapeFrame, type SizeOf,
} from './outline';

/**
 * The onboarding guide (v2): the visitor builds Edward's "c" piece by piece onto dotted **outlines**, then may be guided
 * through the whole word "create" (`word-create-1`). Since v1.2.3 the c is the one INSIDE the word (`findWordC`), placed so
 * the whole word aligned to it fits (`placeWordC`), and it stays in place as the start of "create" (`anchorWord`). Without
 * the word (or a c in it) the c is `lower-c-1`, as before. Pure, no DOM: the step state machine, the "don't show again"
 * storage rule and the callout placement. The component (main.ts) feeds it the board and draws the outlines and the callout.
 *
 * 1. outline: the black oval (the c's first piece).            Done when it is filled (a piece sits exactly on it).
 * 2. outline: the white oval, lying on the black oval.          Done when it is filled.
 * 3. outline: the wedge, at its angle. 3a "drag it into place"; 3b (a wedge is close in position but needs turning) "turn it".
 * 4. no outline. "That's a c." Guide me (only when word-create-1 exists) or Clear for free play. A finished c moved as one
 *    (rigidly, not turned) keeps step 4: its outlines follow it (`rigidShift`).
 * 5. outlines: the whole word, every piece at once, filled in any order. Progress "N of M". Same turning hint as 3b.
 *    v1.2.3: nothing is cleared; the word's outlines are in the c's board frame, so the c's pieces fill theirs ("3 of 32").
 *    Phones (v1.2.2, the compact layout): the word is filled one SECTION at a time (`sections`, split by sections.ts): only
 *    the current section's outlines show and accept a piece. The current section is the first, left to right, with an
 *    unfilled outline, so it too is derived from the board (undoing back into an earlier section makes it current again).
 *    The progress still counts the whole word.
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
  /**
   * The word phase on phones: the word's outlines split into sections (outline indices per section, left to right), filled
   * one section at a time. null: every outline at once (desktop, and always outside the word phase).
   */
  sections: readonly (readonly number[])[] | null;
}

const NONE = Object.freeze([]) as readonly never[];
export const GUIDE_IDLE: GuideState = Object.freeze({
  step: 0, phase: null, letter: NONE, kept: false, theirs: NONE, built: NONE, outlines: NONE, filled: NONE, turn: null, sections: null,
}) as GuideState;

/** Is the guide running (step 0's question included)? */
export const guideRunning = (s: GuideState): boolean => s.phase !== null;

/** Step 0: the guide starts on a board that already has pieces. */
export function askGuide(): GuideState {
  return { ...GUIDE_IDLE, phase: 'ask' };
}

/**
 * The section being filled (phones, step 5): the first section, left to right, that still has an unfilled outline. -1 when
 * there are no sections (desktop) or every outline is filled.
 */
export function currentSection(s: GuideState): number {
  if (s.phase !== 'word' || !s.sections) return -1;
  return s.sections.findIndex((sec) => sec.some((i) => !s.filled[i]));
}

/**
 * The outlines showing (and accepting a piece) in this state: one at a time in steps 1 to 3, every unfilled one in step 5
 * (on phones, every unfilled one of the current section), lowest index (bottom of the stacking order) first.
 */
export function activeOutlines(s: GuideState): number[] {
  if (s.phase === 'c' && s.step >= 1 && s.step <= 3) {
    const i = s.filled.findIndex((f) => !f);
    return i < 0 ? [] : [i];
  }
  if (s.phase === 'word' && s.step === 5) {
    if (!s.sections) return activeIndices(s.filled);
    const k = currentSection(s);
    return k < 0 ? [] : s.sections[k].filter((i) => !s.filled[i]).sort((a, b) => a - b);
  }
  return [];
}

type Carry = Pick<GuideState, 'letter' | 'kept' | 'theirs' | 'built' | 'sections'>;
const carry = (s: GuideState): Carry => ({ letter: s.letter, kept: s.kept, theirs: s.theirs, built: s.built, sections: s.sections });

function derive(phase: 'c' | 'word', outlines: readonly Outline[], w: GuideWorld, c: Carry): GuideState {
  const filled = filledBy(outlines, w.pieces);
  const first = filled.findIndex((f) => !f);
  const step: GuideStep = phase === 'c' ? (first < 0 ? 4 : (Math.min(first + 1, 3) as GuideStep)) : first < 0 ? 6 : 5;
  const s: GuideState = { ...c, sections: phase === 'word' ? c.sections : null, step, phase, outlines, filled, turn: null };
  const active = activeOutlines(s);
  // The turning hint: in step 3 (the wedge) and step 5 (any piece of the word).
  const turn = step === 3 || step === 5 ? needsTurning(outlines, active, filled, w.pieces, w.sizeOf) : null;
  return { ...s, turn };
}

const same = (a: GuideState, b: GuideState) =>
  a.step === b.step && a.phase === b.phase && a.outlines === b.outlines && a.turn === b.turn && a.filled.length === b.filled.length && a.filled.every((f, i) => f === b.filled[i])
  && a.letter === b.letter && a.kept === b.kept && a.theirs === b.theirs && a.built === b.built && a.sections === b.sections;

/**
 * Start (or replay) at step 1 with the c's outlines (already placed on the board). An empty list cannot start it.
 * `from`: step 0's answer, carried on (`kept`, `theirs`); a fresh start has neither.
 */
export function startGuide(cOutlines: readonly Outline[], w: GuideWorld, from: { kept?: boolean; theirs?: readonly string[] } = {}): GuideState {
  if (!cOutlines.length) return GUIDE_IDLE;
  return derive('c', cOutlines, w, { letter: cOutlines, kept: !!from.kept, theirs: from.theirs ?? NONE, built: NONE, sections: null });
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
 * What the guide's clears remove (Clear for free play, Start fresh; Guide me clears nothing since v1.2.3): only the guide-built pieces once the visitor
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
  if (s.phase === 'c' && s.step === 4 && next.step !== 4) {
    // The finished c moved as one (a selection dragged, or that drag undone): its outlines follow it, so it is still the c
    // and the word will be anchored on it where it now is. Turned, or broken apart, it is not: the step goes back.
    const shift = rigidShift(s.letter, s.filled, w.pieces);
    if (shift) {
      const letter = s.letter.map((o) => ({ ...o, x: o.x + shift.dx, y: o.y + shift.dy }));
      return derive('c', letter, w, { ...carry(s), letter });
    }
  }
  return same(s, next) ? s : next;
}

/**
 * The pieces that filled `outlines` (`filled`, all of them) moved together by one translation: every one still there, at
 * its outline's rotation, and each offset from its outline by the same amount (within the fill tolerance). Returns that
 * move (taken from the first piece exactly), or null (something is missing, turned, or out of arrangement, or nothing moved).
 */
export function rigidShift(outlines: readonly Outline[], filled: readonly (string | null)[], pieces: readonly OutlinePiece[]): { dx: number; dy: number } | null {
  if (!outlines.length || filled.length !== outlines.length || filled.some((f) => !f)) return null;
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const ps = filled.map((id) => byId.get(id!));
  if (ps.some((p, i) => !p || p.shapeId !== outlines[i].shapeId || angleGap(p.rotation, outlines[i].rotation) > FILL_ANGLE_EPS)) return null;
  const dx = ps[0]!.x - outlines[0].x, dy = ps[0]!.y - outlines[0].y;
  if (Math.hypot(dx, dy) <= FILL_POS_EPS) return null; // still in place
  const rigid = ps.every((p, i) => Math.hypot(p!.x - outlines[i].x - dx, p!.y - outlines[i].y - dy) <= FILL_POS_EPS);
  return rigid ? { dx, dy } : null;
}

/**
 * Step 4's Guide me: the word's outlines (already placed). Only from step 4. `sections` (phones): the outlines split into
 * sections, filled one at a time (see `withSections`); null: the whole word at once.
 */
export function chooseWord(s: GuideState, wordOutlines: readonly Outline[], w: GuideWorld, sections: readonly (readonly number[])[] | null = null): GuideState {
  if (s.step !== 4 || !wordOutlines.length) return s;
  return derive('word', wordOutlines, w, { ...carry(s), sections: validSections(sections, wordOutlines.length) });
}

/** Sections that cover every outline exactly once, or null (anything else falls back to the whole word at once). */
function validSections(sections: readonly (readonly number[])[] | null, n: number): readonly (readonly number[])[] | null {
  if (!sections || !sections.length) return null;
  const seen = new Set<number>();
  for (const sec of sections) {
    if (!sec.length) return null;
    for (const i of sec) {
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return null;
      seen.add(i);
    }
  }
  return seen.size === n ? sections : null;
}

/**
 * The layout changed during the word phase (a phone rotated into, or a window resized out of, the compact layout): fill
 * by sections, or the whole word at once (null). Nothing on the board changes, so every filled outline stays filled.
 * Only in the word phase.
 */
export function withSections(s: GuideState, sections: readonly (readonly number[])[] | null, w: GuideWorld): GuideState {
  if (s.phase !== 'word') return s;
  const next = validSections(sections, s.outlines.length);
  if (next === s.sections) return s;
  return derive('word', s.outlines, w, { ...carry(s), sections: next });
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

// ---- the c inside the word (v1.2.3) ------------------------------------------------------------------------------

/** Where the c is inside the word: the indices (in the word's pieces) of its positive round, negative round and wedge. */
export interface WordC {
  round: number;
  negative: number;
  wedge: number;
}

type FrameOf = (id: string) => ShapeFrame | undefined;

const overlapArea = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** How far beyond the round and its negative round a wedge may start and still be part of the c, of their bounds' longer side. */
export const WORD_C_REACH = 0.25;

/**
 * Find the guide's c inside a word composition (pure): the LEFTMOST positive round (by the centre of its rotated bounds;
 * ties: the lower index), the negative round whose rotated bounds overlap it the most (ties: the nearer centroid), and,
 * among the wedges whose rotated bounds overlap those two (or come within WORD_C_REACH of them), the one whose centroid is
 * nearest the round's. Null when any of the three is missing. Never by index: the word may be built in any order.
 */
export function findWordC(pieces: readonly Outline[], shapeOf: FrameOf): WordC | null {
  const box = pieces.map((p) => rotatedBounds([p], shapeOf));
  const of = (shapeId: string) => pieces.map((p, i) => (p.shapeId === shapeId && box[i] ? i : -1)).filter((i) => i >= 0);
  const cx = (i: number) => box[i]!.x + box[i]!.w / 2;
  const dist = (i: number, j: number) => Math.hypot(pieces[i].x - pieces[j].x, pieces[i].y - pieces[j].y);
  const rounds = of('positive-round');
  if (!rounds.length) return null;
  const round = rounds.reduce((a, b) => (cx(b) < cx(a) - 1e-9 ? b : a));
  let negative = -1, most = 0;
  for (const j of of('negative-round')) {
    const a = overlapArea(box[round]!, box[j]!);
    if (a > most + 1e-9 || (a > 0 && Math.abs(a - most) <= 1e-9 && negative >= 0 && dist(round, j) < dist(round, negative))) {
      negative = j;
      most = a;
    }
  }
  if (negative < 0) return null;
  const pair = union(box[round]!, box[negative]!);
  const zone = grow(pair, WORD_C_REACH * Math.max(pair.w, pair.h));
  let wedge = -1;
  for (const j of of('wedge')) {
    if (!rectsOverlap(box[j]!, zone)) continue;
    if (wedge < 0 || dist(round, j) < dist(round, wedge) - 1e-9) wedge = j;
  }
  return wedge < 0 ? null : { round, negative, wedge };
}

/** The c's three outlines, picked out of the word's (in the c's step order: black oval, white oval, wedge). */
export function cOutlines(word: readonly Outline[], c: WordC): Outline[] {
  return [word[c.round], word[c.negative], word[c.wedge]];
}

/**
 * Where the c goes so that the WHOLE word, aligned to it, lands in the target area: the word is placed with the centre of
 * its rotated bounds at `centre` (`outlinesAt`, a rigid move), and the c is its three pieces there. On a blank board the
 * centre is the visible board's; after Keep my pieces it is the centre of the spot `besideSpot` found for the word's bounds.
 */
export function placeWordC(word: readonly Outline[], c: WordC, shapeOf: FrameOf, centre: { x: number; y: number }): { word: Outline[]; c: Outline[] } {
  const placed = outlinesAt(word, shapeOf, centre);
  return { word: placed, c: placed.length ? cOutlines(placed, c) : [] };
}

/**
 * Guide me: the word's outlines in the same board frame as the built c, so the c's three pieces sit exactly on their
 * outlines (the c's outlines are copied over as they are; every other outline is moved by the same translation, which
 * takes the word's round onto the c's). Null when `letter` is not this word's c (another arrangement, e.g. the
 * `lower-c-1` fallback, or a c that was turned: only a moved c keeps its rotation as built), or when the word placed there
 * would overlap any rect in `avoid` (pieces that are not the c): the caller then places the word fresh.
 */
export function anchorWord(word: readonly Outline[], c: WordC, letter: readonly Outline[], shapeOf: FrameOf, avoid: readonly Rect[] = []): Outline[] | null {
  const want = cOutlines(word, c);
  if (letter.length !== 3 || want.some((o, i) => !o || o.shapeId !== letter[i].shapeId)) return null;
  for (let i = 1; i < 3; i++) {
    const a = { x: want[i].x - want[0].x, y: want[i].y - want[0].y }, b = { x: letter[i].x - letter[0].x, y: letter[i].y - letter[0].y };
    if (Math.hypot(a.x - b.x, a.y - b.y) > FILL_POS_EPS) return null;
  }
  if (want.some((o, i) => angleGap(o.rotation, letter[i].rotation) > FILL_ANGLE_EPS)) return null;
  const dx = letter[0].x - want[0].x, dy = letter[0].y - want[0].y;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6 || 0;
  const at = new Map([[c.round, letter[0]], [c.negative, letter[1]], [c.wedge, letter[2]]]);
  const out = word.map((p, i) => at.get(i) ?? { shapeId: p.shapeId, x: r6(p.x + dx), y: r6(p.y + dy), rotation: Math.round(normalise(p.rotation) * 100) / 100 || 0 });
  const b = rotatedBounds(out, shapeOf);
  if (b && avoid.some((q) => rectsOverlap(b, q))) return null;
  return out.map((o) => ({ ...o }));
}

/** The fallback at Guide me: the c's pieces are the visitor's now (never removed by the guide); the word goes in fresh. */
export function adoptTheirs(s: GuideState, ids: readonly string[]): GuideState {
  const add = ids.filter((id) => !s.theirs.includes(id));
  if (!add.length) return s;
  return { ...s, theirs: [...s.theirs, ...add], built: s.built.filter((id) => !add.includes(id)) };
}

/**
 * Phones, the word by sections: the largest free part of `area` (screen px) to frame content of `size` in. Each blocker
 * (the callout, the action bar) that cuts into the area leaves four candidate strips (left of, right of, above or below
 * it); every combination is tried and the one that shows the content largest (`scale`: screen px per content unit, less
 * `pad` on each side) wins. Ties: the first found (blockers in order; left, right, above, below). With no blockers the
 * whole area. Pure.
 */
export function freeRect(size: { w: number; h: number }, area: Rect, blockers: readonly Rect[], pad = 0): { rect: Rect; scale: number } {
  const scaleOf = (r: Rect) => Math.min((r.w - 2 * pad) / Math.max(1e-6, size.w), (r.h - 2 * pad) / Math.max(1e-6, size.h));
  let best: { rect: Rect; scale: number } = { rect: area, scale: -Infinity };
  const walk = (r: Rect, i: number) => {
    if (r.w <= 2 * pad || r.h <= 2 * pad) return;
    const hit = blockers.slice(i).findIndex((q) => rectsOverlap(r, q));
    if (hit < 0) {
      const sc = scaleOf(r);
      if (sc > best.scale + 1e-9) best = { rect: r, scale: sc };
      return;
    }
    const q = blockers[i + hit];
    const right = r.x + r.w, bottom = r.y + r.h;
    for (const c of [
      { x: r.x, y: r.y, w: q.x - r.x, h: r.h }, // left of it
      { x: q.x + q.w, y: r.y, w: right - (q.x + q.w), h: r.h }, // right of it
      { x: r.x, y: r.y, w: r.w, h: q.y - r.y }, // above it
      { x: r.x, y: q.y + q.h, w: r.w, h: bottom - (q.y + q.h) }, // below it
    ]) walk(c, i + hit + 1);
  };
  walk(area, 0);
  return best.scale === -Infinity ? { rect: area, scale: scaleOf(area) } : best;
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
