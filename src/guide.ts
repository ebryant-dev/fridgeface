import { rotatedBounds } from './camera';
import { normalise } from './rotation';
import {
  FILL_ANGLE_EPS, FILL_POS_EPS, activeIndices, angleGap, clickIn, filledBy, needsTurning, outlineAngleGap, outlineMatch, outlineOf, outlinesAt, type ClickResult, type Outline, type OutlinePiece,
  type ShapeFrame, type SizeOf,
} from './outline';
import { stackCheck, stackPrompt, type Overlaps, type StackPrompt } from './stacking';
import { planBatches, type BatchOptions } from './batches';
import { curatedPlan } from './guide-plans';

/**
 * The onboarding guide (copy v4, v1.6.0; v1.6.6: a piece that fits its outline completely is deselected (main.ts `guideSnap`, `guideNextFill`), so the next step starts clean: the wedge in position but still to turn (1b) keeps its selection, step 4 and the word's stacking prompts select their piece on purpose and deselect it once answered; v1.6.1: black callout, "Don't show again" only at step 0, and
 * step 0 on every automatic start: "Would you like a tutorial?" on a blank board, "Start on a clean fridge?" otherwise; v1.6.3:
 * the guide bar, below, carries Back / Next / Exit on the instruction steps; v1.6.5: the block's Back / Forward the callout points at pulses blue too (`syncBlockHint`, main.ts: c step 4 and the word's stacking prompts; only while the callout targets it), step 5 reads "That's the letter 'c'."; v1.6.4: the tray shape to drag pulses, `trayHints`, and the
 * turning lesson's outline is drawn behind its piece): the visitor builds Edward's "c" piece by piece onto blueprint-blue **outlines**
 * (solid for positive shapes, dotted for negative ones), learning stacking on the way, then may be guided through the whole
 * word "create" (`word-create-1`). The c is the one INSIDE the word (`findWordC`), placed so the whole word aligned to it
 * fits (`placeWordC`), and it stays in place as the start of "create" (`anchorWord`). Without the word (or a c in it) the c
 * is `lower-c-1`. Pure, no DOM: the step state machine, the "don't show again" storage rule and the callout placement. The
 * component (main.ts) feeds it the board and draws the outlines and the callout.
 *
 * Copy v4 (v1.6.0) builds the c wedge first, so the stacking lesson is bringing the wedge (a negative shape) forward to cut
 * into the black oval that landed on top of it (copy v3, v1.3.0 to v1.5.1, built white oval, black oval, "send the black
 * oval back", wedge). Order: `cSequence`.
 *
 * 1. outline: the wedge (dotted). 1a "Drag the wedge onto the fridge.": the outline is drawn at its LANDING angle
 *    (`landingOutline`: the true outline's position at rotation 0, the angle a piece dragged from the tray lands at), so its
 *    silhouette matches the piece in the hand. A wedge released close to that position at about that angle clicks into the
 *    position only, keeping its angle (`guideClickIn`). A piece turns about its centroid, its (x, y), so turning it there
 *    carries it into the true outline. 1b (a wedge is close in position but needs turning: `needsTurning`): the outline is
 *    drawn at its TRUE angle and the callout says "Now turn it with the round handle to fit." (pointing at the rotate
 *    handle; v1.6.3: that handle wears a pulsing blueprint-blue ring and the piece's dashed selection box is hidden,
 *    `teachingTurn`, as for step 6's turning hint; v1.6.4: that piece's outline is drawn BEHIND it); turned close to the angle it clicks in (position and angle) as any piece
 *    does. Done when it is filled.
 * 2. outline: the black oval (solid), on the wedge. Done when it is filled. A new piece lands on top, so it covers the wedge.
 * 3. outline: the white oval (dotted), on the black one. Done when it is filled (it lands on top too).
 * 4. no outline: "Bring the wedge forward so it cuts into the black." Points at the button block's Forward (Bring forward)
 *    (the wedge is selected for it). Done when every c piece is stacked as in the letter against every c piece it overlaps
 *    AND whose colour differs (v1.6.2: the white oval and the wedge are both white, so their order never matters; stacking.ts;
 *    the wedge and the black oval always count as overlapping, as they do in the c). So the wedge only has to pass the black
 *    oval: ONE Bring forward press whether or not it is above the white oval. `stack` is the prompt, the wedge first; any
 *    other mis-stacked c piece (the visitor restacked one) gets the generic Send it back / Bring it forward prompt.
 * 5. no outline. "That's the letter 'c'." / "Do you want to continue the tutorial?" with Guide me ("Yes, continue"; only when
 *    word-create-1 exists, as is the question) or Clear for free play ("No, clear for free play"). A finished c moved as one
 *    (rigidly, not turned) keeps step 5: its outlines follow it (`rigidShift`).
 * 6. outlines: the word, built in STACKING ORDER one small BATCH at a time (v1.4.0, every layout; batches.ts): only the
 *    current batch's outlines show and accept a piece, filled in any order. Every outline of a batch is ready (each lower
 *    piece it overlaps is already placed) and no two of a batch overlap, so a visitor who takes each piece from the tray
 *    (it lands on top) can never stack one wrongly (proved in batches.ts). The current batch is the first with a piece not
 *    done, so it too is derived from the board (undo and redo move between batches). A word piece is DONE when it is placed
 *    AND stacked right against every placed piece it overlaps (stacking.ts); progress "N of M" (in the guide bar since v1.6.3) counts done pieces. The
 *    stacking prompts (`stack`: Send it back / Bring it forward, the most recently placed first) remain only as a safety net,
 *    for a visitor who reorders pieces themselves. The order of two pieces of the SAME colour never matters (v1.6.2: black on
 *    black, white on white; stacking.ts), so such a pair is never checked (the flower's black petals come up together as one batch). Same turning hint as 1b. Nothing is cleared at Guide me; the word's
 *    outlines are in the c's board frame, so the c's pieces fill theirs (they are batch 0, already done).
 * 7. no outline. "Great work! Now you're ready to create on your own." Start fresh or Keep it. Only once every piece is done: the stacking order of every
 *    overlapping pair is the word's.
 *
 * The tray hint (v1.6.4, `trayHints`): while the guide asks the visitor to drag a shape from the tray (1a, 2, 3, and every
 * shape the word's current batch still needs in 6), that tray button wears a pulsing blueprint-blue ring of the shape's
 * silhouette (main.ts). None on 1b (the wedge is out), 4, 5, 7, the questions, or while a stacking prompt shows.
 *
 * The guide NEVER fixes the stacking order by itself (a click-in sets position and angle only); only Next (the guide bar)
 * restacks the prompted piece for the visitor.
 *
 * The guide bar (v1.6.3): on every INSTRUCTION step (c steps 1 to 4, 1a and 1b included, and word step 6; `guideBarShown`)
 * a slim black bar at the top of the board carries the guide's controls, so the callout shows only the instruction:
 * [Back] [Next] on the left, the step count in the middle (`guideBarCount`: "Step N of 4" in the c, where 1 is the wedge,
 * dragged AND turned, 2 the black oval, 3 the white oval, 4 bring forward; the word's progress "N of M"), [Exit] on the
 * right. The QUESTION steps (step 0's welcome and "Start on a clean fridge?", 5, 7) hide it and keep their own buttons.
 * - Next: always offered on an instruction step (v1.6.3 retired the 10 s stuck delay); it does `nextAction`.
 * - Exit: Exit guide (`endGuide`).
 * - Back: undoes board history until the guide's POSITION (`guidePosition`) drops below the current one (`backSteps`):
 *   the c's positions are 1a = 0, 1b = 1, 2 = 2, 3 = 3, 4 = 4, so from 1b it undoes the wedge's drop (its click-in is in
 *   the same undo step: the wedge goes, back to 1a); from 2 it undoes back to before the wedge's completing turn (1b);
 *   from 3 to before the black oval was placed; from 4 to before the white oval was placed. Undo steps that do not move the
 *   guide back (a piece nudged aside, a stray piece dropped) are undone on the way. In the word the position is the count
 *   of DONE pieces: Back undoes until one fewer is done (the most recent placement or fix; across a batch boundary that
 *   is the previous batch again). It never undoes past where the guide started (the history depth when the c's step 1,
 *   or the word, began: the visitor's own earlier pieces and step 0's Clear and start are never touched) and never below
 *   the first position (c 1a; the word's done count at Guide me): there it is disabled. Every undo is a normal one, so
 *   Redo brings it all back; the step is still derived from the board.
 *
 * Which step shows is DERIVED from the board every time (`observeGuide`): an outline is filled when a piece of its shape
 * sits exactly on it, and the stacking is read from the board's order. So deleting, moving or restacking a piece, and
 * undo/redo, keep the guide in step with the board. The only thing that is never undone is a button the visitor chose:
 * after Guide me the guide stays on the word (steps 6 and 7) whatever happens to the board.
 *
 * Click-in (`guideClickIn`): only while a step with outlines is showing, a released piece of the right shape close to an
 * active outline clicks exactly into it (see outline.ts for the tolerance). With the guide not running, it is always null.
 *
 * 0. Only when the guide starts on a board that already has pieces: "Start on a clean fridge?" Clear and start (the board
 *    is cleared as ONE undoable step, then step 1 on a blank board) or Keep my pieces (their pieces stay; the c's outlines,
 *    and later the word's, go in EMPTY board beside them: `besideSpot`, framed by `frameBeside`).
 *
 * The visitor's own pieces: the pieces on the board when step 0 was answered are THEIRS (`theirs`), and so is anything they
 * add or move during the guide that is not clicked into an outline. The guide only ever removes GUIDE-BUILT pieces
 * (`built`: clicked into an outline, or placed by Next) still sitting on an outline (`guideBuilt`). After Keep (or when any
 * of their pieces is back on the board, e.g. after undoing Clear and start) the guide's clears are scoped to those
 * (`guideClearPlan`); on a blank start they clear the whole board as before.
 */

export const GUIDE_STORAGE_KEY = 'fridgeface:guide:v2';
export const GUIDE_OFF_VALUE = 'off';
/** The letter the guide builds, and the word it offers next (suggestion files lower-c-1.json and word-create-1.json). */
export const GUIDE_LETTER = { char: 'c', variant: 1 } as const;
export const GUIDE_WORD = { text: 'create', variant: 1 } as const;

/** Edward's approved copy v4 (v1.6.0), word for word. */
export const GUIDE_COPY = {
  step0: 'Start on a clean fridge?',
  /** Step 0 on a blank board (v1.6.1, automatic starts only): the offer. */
  welcome: 'Would you like a tutorial?',
  yes: 'Yes',
  no: 'No',
  clearStart: 'Clear and start',
  keepMine: 'Keep my pieces',
  /** Step 1a: the wedge, its outline at the angle it lands at. */
  step1: 'Drag the wedge onto the fridge.',
  /** Step 1b (and step 6's turning hint): a piece in position but at the wrong angle. */
  step1b: 'Now turn it with the round handle to fit.',
  /** Touch devices: one sentence. */
  step1bTouch: 'Now turn it with the round handle to fit, or twist with two fingers.',
  step2: 'Now drag the black oval into place.',
  step3: 'Now drag the white oval onto it.',
  step4: 'Bring the wedge forward so it cuts into the black.',
  step5: "That's the letter 'c'.",
  step5Ask: 'Do you want to continue the tutorial?',
  /** Step 5's "Guide me" button (into the word "create"). */
  guideMe: 'Yes, continue',
  /** Step 5's "Clear for free play" button. */
  clearFree: 'No, clear for free play',
  step6: 'Fill in the outlines to spell "create".',
  progress: (done: number, total: number) => `${done} of ${total}`,
  /** Step 6: a placed piece stacked wrongly against a piece it overlaps (points at Send backward / Bring forward). */
  stackBack: 'Send it back so it sits behind.',
  stackForward: 'Bring it forward so it sits in front.',
  step7: "Great work! Now you're ready to create on your own.",
  startFresh: 'Start fresh',
  keepIt: 'Keep it',
  /** Closes the guide for this visit (pieces stay; it returns next visit). */
  skip: 'Exit guide',
  dontShow: "Don't show again",
  next: 'Next',
  /** The guide bar (v1.6.3): Back, Exit (Exit guide), and the c's step count. */
  back: 'Back',
  exit: 'Exit',
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  replay: 'Show guide',
} as const;

export type GuideStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/**
 * 'ask': step 0 (the board already had pieces). 'welcome': step 0 on a blank board (v1.6.1: an automatic start asks "Would
 * you like a tutorial?" with Yes / No / Don't show again; "Show guide" skips it). 'c': steps 1 to 5 (the letter). 'word': steps 6 and 7, after the visitor
 * chose Guide me (never goes back). null: the guide is not running.
 */
export type GuidePhase = 'ask' | 'welcome' | 'c' | 'word';

export interface GuideWorld {
  /** The composition, in stacking order (bottom first). */
  pieces: readonly OutlinePiece[];
  sizeOf: SizeOf;
  /**
   * Real-geometry overlap of two pieces (the component passes its convex outlines' intersection). Absent (unit tests with
   * synthetic shapes): two pieces overlap when their centroids are closer than half their sizes added together.
   */
  overlaps?: Overlaps;
}

const roughOverlap = (sizeOf: SizeOf): Overlaps => (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < (sizeOf(a.shapeId) + sizeOf(b.shapeId)) / 2;
/** The world's overlap test (or the rough one). */
export const overlapsOf = (w: GuideWorld): Overlaps => w.overlaps ?? roughOverlap(w.sizeOf);

/** `phase` null: the guide is not running (`step` 0). `phase` 'ask' or 'welcome' is step 0 showing. */
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
  /** Per outline: the piece sitting exactly on it (PLACED), or null. */
  filled: readonly (string | null)[];
  /** Per outline: placed AND stacked right against every placed piece it overlaps (stacking.ts). What the progress counts. */
  done: readonly boolean[];
  /** The placed pieces, in the order they were placed (oldest first): the most recent mis-stacked one is prompted first. */
  recent: readonly string[];
  /** Step 4, and step 6 whenever a placed piece is mis-stacked: which piece to restack, which way, how many presses. */
  stack: StackPrompt | null;
  /** A piece close to an active outline of its shape but at the wrong angle (step 1b, or the same hint in step 6), or null. */
  turn: string | null;
  /**
   * The word phase: the word's outlines in batches (outline indices per batch, in the order they are built; batch 0 is the
   * pieces already placed at Guide me), filled one batch at a time (batches.ts). null outside the word phase.
   */
  batches: readonly (readonly number[])[] | null;
}

const NONE = Object.freeze([]) as readonly never[];
export const GUIDE_IDLE: GuideState = Object.freeze({
  step: 0, phase: null, letter: NONE, kept: false, theirs: NONE, built: NONE, outlines: NONE, filled: NONE, done: NONE, recent: NONE, stack: null, turn: null,
  batches: null,
}) as GuideState;

/** Is the guide running (step 0's question included)? */
export const guideRunning = (s: GuideState): boolean => s.phase !== null;

/** Step 0 on a blank board (an automatic start): "Would you like a tutorial?". Yes starts step 1, No closes the guide. */
export function welcomeGuide(): GuideState {
  return { ...GUIDE_IDLE, phase: 'welcome' };
}

/** Step 0: the guide starts on a board that already has pieces. */
export function askGuide(): GuideState {
  return { ...GUIDE_IDLE, phase: 'ask' };
}

/**
 * The batch being filled (step 6): the first batch with a piece not done (unplaced, or placed but mis-stacked). -1 outside
 * the word phase or when every piece is done.
 */
export function currentBatch(s: GuideState): number {
  if (s.phase !== 'word' || !s.batches) return -1;
  return s.batches.findIndex((b) => b.some((i) => !s.done[i]));
}

/**
 * The c's outlines in the order the guide asks for them (copy v4): the wedge first, then the black oval, then the white
 * oval, then any others. Outlines without all three: in their own order.
 */
export function cSequence(outlines: readonly Outline[]): number[] {
  const wedge = outlines.findIndex((o) => o.shapeId === 'wedge');
  const black = outlines.findIndex((o) => o.shapeId === 'positive-round');
  const white = outlines.findIndex((o) => o.shapeId === 'negative-round');
  const all = outlines.map((_, i) => i);
  if (wedge < 0 || black < 0 || white < 0) return all;
  return [wedge, black, white, ...all.filter((i) => i !== wedge && i !== black && i !== white)];
}

/**
 * The wedge's outline as first shown (step 1a, copy v4): the true outline's position at rotation 0, the angle a piece
 * dragged from the tray lands at (`Composition.addPiece`). A single piece turns about its centroid, which is its (x, y), so
 * a piece sitting on this turns into the true outline without moving.
 */
export function landingOutline(o: Outline): Outline {
  return { ...o, rotation: 0 };
}

/** Step 1a: the wedge's outline is drawn (and accepts a piece, position only) at its landing angle. */
const landing = (s: GuideState, i: number): boolean =>
  s.phase === 'c' && s.step === 1 && !s.turn && s.outlines[i]?.shapeId === 'wedge' && !s.filled[i];

/**
 * The outline as it is drawn (and framed, and kept clear by the callout): step 1a draws the wedge at its landing angle
 * (`landingOutline`); otherwise the outline itself.
 */
export function shownOutline(s: GuideState, i: number): Outline {
  return landing(s, i) ? landingOutline(s.outlines[i]) : s.outlines[i];
}

/**
 * The outlines showing (and accepting a piece) in this state: one at a time in steps 1, 2 and 3 (none in step 4, the
 * stacking lesson), every unfilled one of the current batch in step 6, lowest index (bottom of the stacking order) first.
 */
export function activeOutlines(s: GuideState): number[] {
  if (s.phase === 'c' && (s.step === 1 || s.step === 2 || s.step === 3)) {
    const i = cSequence(s.outlines).find((k) => !s.filled[k]);
    return i === undefined ? [] : [i];
  }
  if (s.phase === 'word' && s.step === 6) {
    if (!s.batches) return activeIndices(s.filled);
    const k = currentBatch(s);
    return k < 0 ? [] : s.batches[k].filter((i) => !s.filled[i]).sort((a, b) => a - b);
  }
  return [];
}

type Carry = Pick<GuideState, 'letter' | 'kept' | 'theirs' | 'built' | 'batches' | 'recent'>;
const carry = (s: GuideState): Carry => ({ letter: s.letter, kept: s.kept, theirs: s.theirs, built: s.built, batches: s.batches, recent: s.recent });

/** The placed pieces in the order they were placed: the ones still placed keep their turn, newly placed ones go last. */
function updateRecent(recent: readonly string[], filled: readonly (string | null)[]): readonly string[] {
  const now = filled.filter((id): id is string => !!id);
  const kept = recent.filter((id) => now.includes(id));
  const added = now.filter((id) => !kept.includes(id));
  return !added.length && kept.length === recent.length ? recent : [...kept, ...added];
}

/**
 * The c (steps 1 to 5, copy v4): the wedge, the black oval, the white oval, then the wedge brought forward. `recent`: the
 * placed pieces, oldest first (the stacking prompt asks about the wedge first).
 */
function deriveC(
  outlines: readonly Outline[], w: GuideWorld, filled: (string | null)[], recent: readonly string[],
): { step: GuideStep; done: boolean[]; stack: StackPrompt | null } {
  const seq = cSequence(outlines);
  const done = filled.map(Boolean);
  const first = seq.findIndex((i) => !filled[i]);
  if (first === 0) return { step: 1, done, stack: null };
  if (first === 1) return { step: 2, done, stack: null };
  if (first >= 2) return { step: 3, done, stack: null };
  // Every piece placed: the stacking lesson. The wedge and the black oval always count as overlapping (as they do in the
  // c, where the wedge cuts into it); every other pair by its real geometry.
  const wedgeId = filled[outlines.findIndex((o) => o.shapeId === 'wedge')] ?? null;
  const blackId = filled[outlines.findIndex((o) => o.shapeId === 'positive-round')] ?? null;
  const ov = overlapsOf(w);
  const pair = (a: OutlinePiece, b: OutlinePiece) => !!wedgeId && !!blackId && ((a.id === wedgeId && b.id === blackId) || (a.id === blackId && b.id === wedgeId));
  const overlaps: Overlaps = (a, b) => pair(a, b) || ov(a, b);
  // The wedge is the lesson: it is asked about first (the most recent in the prompt's eyes).
  const order = wedgeId ? [...recent.filter((id) => id !== wedgeId), wedgeId] : recent;
  const stack = stackPrompt(filled, w.pieces, overlaps, order);
  if (!stack) return { step: 5, done, stack: null };
  return { step: 4, done: stackCheck(filled, w.pieces, overlaps).done, stack };
}

function derive(phase: 'c' | 'word', outlines: readonly Outline[], w: GuideWorld, c: Carry): GuideState {
  const filled = filledBy(outlines, w.pieces);
  const recent = updateRecent(c.recent, filled);
  let step: GuideStep, done: boolean[], stack: StackPrompt | null;
  if (phase === 'c') ({ step, done, stack } = deriveC(outlines, w, filled, recent));
  else {
    const ov = overlapsOf(w);
    done = stackCheck(filled, w.pieces, ov).done;
    step = done.every(Boolean) ? 7 : 6;
    stack = step === 6 ? stackPrompt(filled, w.pieces, ov, recent) : null;
  }
  const s: GuideState = { ...c, recent, batches: phase === 'word' ? c.batches : null, step, phase, outlines, filled, done, stack, turn: null };
  const active = activeOutlines(s);
  // The turning hint: in step 1 (the wedge) and step 6 (any piece of the word).
  const turn = step === 1 || step === 6 ? needsTurning(outlines, active, filled, w.pieces, w.sizeOf) : null;
  return { ...s, turn };
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const samePrompt = (a: StackPrompt | null, b: StackPrompt | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.dir === b.dir && a.presses === b.presses && sameList(a.order, b.order));
const same = (a: GuideState, b: GuideState) =>
  a.step === b.step && a.phase === b.phase && a.outlines === b.outlines && a.turn === b.turn && sameList(a.filled, b.filled) && sameList(a.done, b.done)
  && sameList(a.recent, b.recent) && samePrompt(a.stack, b.stack)
  && a.letter === b.letter && a.kept === b.kept && a.theirs === b.theirs && a.built === b.built && a.batches === b.batches;

/**
 * Start (or replay) at step 1 with the c's outlines (already placed on the board). An empty list cannot start it.
 * `from`: step 0's answer, carried on (`kept`, `theirs`); a fresh start has neither.
 */
export function startGuide(cOutlines: readonly Outline[], w: GuideWorld, from: { kept?: boolean; theirs?: readonly string[] } = {}): GuideState {
  if (!cOutlines.length) return GUIDE_IDLE;
  return derive('c', cOutlines, w, { letter: cOutlines, kept: !!from.kept, theirs: from.theirs ?? NONE, built: NONE, batches: null, recent: NONE });
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

/**
 * Move the c's outlines (nothing filled yet: e.g. their pieces came back on an undo and the outlines sat on them). Never
 * while a wedge waits to be turned into its outline (step 1b): it is the c begun, not their work.
 */
export function moveLetter(s: GuideState, cOutlines: readonly Outline[], w: GuideWorld): GuideState {
  if (s.phase !== 'c' || s.filled.some(Boolean) || s.turn || !cOutlines.length) return s;
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
  if (!s.step || !s.phase || s.phase === 'ask' || s.phase === 'welcome') return s;
  const next = derive(s.phase, s.outlines, w, carry(s));
  if (s.phase === 'c' && s.step === 5 && next.step !== 5) {
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
  if (ps.some((p, i) => !p || p.shapeId !== outlines[i].shapeId || outlineAngleGap(outlines[i], p.rotation) > FILL_ANGLE_EPS)) return null;
  const dx = ps[0]!.x - outlines[0].x, dy = ps[0]!.y - outlines[0].y;
  if (Math.hypot(dx, dy) <= FILL_POS_EPS) return null; // still in place
  const rigid = ps.every((p, i) => Math.hypot(p!.x - outlines[i].x - dx, p!.y - outlines[i].y - dy) <= FILL_POS_EPS);
  return rigid ? { dx, dy } : null;
}

/**
 * Step 5's Guide me: the word's outlines (already placed). Only from step 5. The word is planned into batches here, once
 * (a curated plan for the word if there is one, `curatedPlan`; else `planBatches`): the outlines already filled (the c) are batch 0, and the plan follows the word's stacking order from
 * them. `plan`: how outlines are measured for the batches' locality (the component passes the real outlines' bounds and its
 * span); absent, each outline is a square of its shape's size and a batch may spread anywhere (unit tests).
 */
export function chooseWord(s: GuideState, wordOutlines: readonly Outline[], w: GuideWorld, plan: Partial<BatchOptions> = {}): GuideState {
  if (s.step !== 5 || !wordOutlines.length) return s;
  const placed = filledBy(wordOutlines, w.pieces).flatMap((id, i) => (id ? [i] : []));
  const boxOf = plan.boxOf ?? ((o: Outline) => {
    const z = w.sizeOf(o.shapeId);
    return { x: o.x - z / 2, y: o.y - z / 2, w: z, h: z };
  });
  // A plan curated by hand for this very word (guide-plans.ts), when there is one and it is valid; else the automatic planner.
  const curated = curatedPlan(wordOutlines, overlapsOf(w), placed);
  const batches = curated?.batches ?? planBatches(wordOutlines, overlapsOf(w), placed, { ...plan, boxOf, span: plan.span ?? Infinity });
  return derive('word', wordOutlines, w, { ...carry(s), batches });
}

/** Skip, Don't show again, Clear for free play, Start fresh, Keep it (and step 0's Skip / Don't show again). */
export function endGuide(): GuideState {
  return GUIDE_IDLE;
}

/** Step 6's progress: pieces DONE (placed and stacked right), of all of them. */
export function guideProgress(s: GuideState): { done: number; total: number } {
  return { done: s.done.filter(Boolean).length, total: s.done.length };
}

/**
 * A released piece (or several): what clicks into the active outlines, if anything. Always null when the guide is not
 * running. Step 1a (copy v4): a wedge that does not fit the true outline but is released close to its LANDING outline
 * (`landingOutline`: within the click-in position tolerance, and the angle tolerance of rotation 0) clicks into its position
 * only, keeping its own angle; the turning hint (1b) then asks for the turn.
 */
export function guideClickIn(s: GuideState, w: GuideWorld, released: readonly string[]): ClickResult | null {
  if (!s.step) return null;
  const active = activeOutlines(s);
  const r = clickIn(s.outlines, active, w.pieces, released, w.sizeOf);
  if (r || !(s.phase === 'c' && s.step === 1)) return r;
  const byId = new Map(w.pieces.map((p) => [p.id, p]));
  const filled = filledBy(s.outlines, w.pieces);
  for (const i of active) {
    if (filled[i] || s.outlines[i].shapeId !== 'wedge') continue;
    const o = landingOutline(s.outlines[i]);
    for (const id of released) {
      const p = byId.get(id);
      if (!p || filled.includes(id) || outlineMatch(o, p, w.sizeOf) !== 'fit') continue;
      if (Math.hypot(p.x - o.x, p.y - o.y) <= FILL_POS_EPS) continue; // already there: nothing to click
      return { placements: [{ id, x: o.x, y: o.y, rotation: p.rotation, outline: i }] };
    }
  }
  return null;
}

/** The lowest active outline (the one Next fills when no piece needs restacking), or null on steps without outlines. */
export function nextOutline(s: GuideState): number | null {
  return activeOutlines(s)[0] ?? null;
}

/**
 * Next (the guide bar's) does the current thing for the visitor: restack the prompted piece (step 4, or step 6 while a
 * piece is mis-stacked), else fill the lowest active outline. Null on steps with nothing to do (5, 7).
 */
export function nextAction(s: GuideState): { kind: 'stack'; prompt: StackPrompt } | { kind: 'place'; outline: number } | null {
  if (s.stack && (s.step === 4 || s.step === 6)) return { kind: 'stack', prompt: s.stack };
  const i = nextOutline(s);
  return i === null ? null : { kind: 'place', outline: i };
}

// ---- the guide bar (v1.6.3) -------------------------------------------------------------------------------------

/** An instruction step: the c's steps 1 to 4 (1a and 1b) and the word's step 6. The guide bar shows only on these. */
export function guideBarShown(s: GuideState): boolean {
  return (s.phase === 'c' && s.step >= 1 && s.step <= 4) || (s.phase === 'word' && s.step === 6);
}

/** The c's steps in the bar's count (1 is the wedge, dragged and turned). */
export const C_STEPS = 4;

/** The guide bar's count: "Step N of 4" in the c, the word's progress "N of M"; null where the bar is hidden. */
export function guideBarCount(s: GuideState): string | null {
  if (!guideBarShown(s)) return null;
  if (s.phase === 'c') return GUIDE_COPY.stepOf(s.step, C_STEPS);
  const p = guideProgress(s);
  return GUIDE_COPY.progress(p.done, p.total);
}

/**
 * Where the guide is, as one number that grows as the visitor goes forward: the c's 1a = 0, 1b = 1, 2 = 2, 3 = 3, 4 = 4,
 * 5 = 5; the word's count of done pieces. -1 when the guide is not on the c or the word.
 */
export function guidePosition(s: GuideState): number {
  if (s.phase === 'c') return s.step === 1 ? (s.turn ? 1 : 0) : s.step;
  if (s.phase === 'word') return s.done.filter(Boolean).length;
  return -1;
}

/**
 * Back: how many undo steps take the guide back one position (`guidePosition`), or 0 when Back cannot (not an instruction
 * step, at or below `floor`, or no undo step within `past` does). `past`: the undo snapshots the guide may go back through,
 * most recent first, stopping at where the guide started (the caller cuts it there). `worldOf`: the guide's world for a
 * snapshot. Pure: each snapshot is judged as the board would be after undoing back to it (`observeGuide`).
 */
export function backSteps(
  s: GuideState, past: readonly (readonly OutlinePiece[])[], worldOf: (pieces: readonly OutlinePiece[]) => GuideWorld, floor = 0,
): number {
  if (!guideBarShown(s)) return 0;
  const pos = guidePosition(s);
  if (pos <= floor) return 0;
  for (let k = 1; k <= past.length; k++) {
    if (guidePosition(observeGuide(s, worldOf(past[k - 1]))) < pos) return k;
  }
  return 0;
}

/**
 * The piece the guide is teaching to turn (c step 1b, and the word's turning hint): its rotate handle pulses and its
 * selection box is hidden. Null otherwise.
 */
export function teachingTurn(s: GuideState): string | null {
  return s.turn && ((s.phase === 'c' && s.step === 1) || (s.phase === 'word' && s.step === 6)) ? s.turn : null;
}

/**
 * The tray shapes the guide is asking the visitor to drag (v1.6.4): their tray buttons wear a pulsing blueprint-blue
 * ring. c step 1a (the wedge), 2 (the black oval), 3 (the white oval); word step 6: every shape an unfilled outline of the
 * current batch still needs. A piece already out and waiting to be turned (`turn`, whose shape `shapeOf` gives) covers one
 * outline of its shape, so 1b shows none. None while a stacking prompt shows (the callout points at Back / Forward then),
 * nor on any other step. Shape ids, each once, in outline order.
 */
export function trayHints(s: GuideState, shapeOf: (id: string) => string | undefined = () => undefined): string[] {
  if (s.stack) return [];
  if (!(s.phase === 'c' && (s.step === 1 || s.step === 2 || s.step === 3)) && !(s.phase === 'word' && s.step === 6)) return [];
  const need = new Map<string, number>();
  for (const i of activeOutlines(s)) need.set(s.outlines[i].shapeId, (need.get(s.outlines[i].shapeId) ?? 0) + 1);
  // (`turn` is always close to an active outline of its own shape; in the c that is the one outline showing.)
  const t = s.turn ? (shapeOf(s.turn) ?? (s.phase === 'c' ? [...need.keys()][0] : undefined)) : undefined;
  if (t && need.has(t)) need.set(t, need.get(t)! - 1);
  return [...need].filter(([, n]) => n > 0).map(([id]) => id);
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

/** The c's three outlines, picked out of the word's (in the word's stacking order: black oval, white oval, wedge). */
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
  const out = word.map((p, i) => at.get(i) ?? outlineOf(p.shapeId, r6(p.x + dx), r6(p.y + dy), Math.round(normalise(p.rotation) * 100) / 100 || 0, shapeOf));
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
 * Phones, the word batch by batch: the largest free part of `area` (screen px) to frame content of `size` in. Each blocker
 * (the callout, the button block) that cuts into the area leaves four candidate strips (left of, right of, above or below
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

/**
 * The spot nearest the centre of the bounds that is clear of `obstacles`. With `avoid` (what it would rather leave visible:
 * the soft rects and the pieces, given up only because no spot clears them), the clear spot covering the fewest of them
 * (then the least area of them) wins, nearness breaking ties.
 */
function centred(size: { w: number; h: number }, bounds: Rect, obstacles: readonly Rect[], avoid: readonly Rect[] = []): Rect | null {
  const xs = along(bounds.x + (bounds.w - size.w) / 2, bounds.x, bounds.x + bounds.w - size.w, 16);
  const ys = along(bounds.y + (bounds.h - size.h) / 2, bounds.y, bounds.y + bounds.h - size.h, 8);
  const cx = xs[0], cy = ys[0];
  const all: Rect[] = [];
  for (const y of ys) for (const x of xs) all.push({ x, y, w: size.w, h: size.h });
  all.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  const clear = all.filter((r) => !obstacles.some((o) => rectsOverlap(r, o)));
  if (!avoid.length || clear.length < 2) return clear[0] ?? null;
  let best: { r: Rect; n: number; a: number } | null = null;
  for (const r of clear) {
    const n = covers(r, avoid), a = coverArea(r, avoid);
    if (!best || n < best.n || (n === best.n && a < best.a - 1)) best = { r, n, a };
    if (!n) break; // nearest spot clear of all of them
  }
  return best!.r;
}

/**
 * Place a callout of `size` next to `target` (all in the same px space), fully inside `bounds`, clear of `obstacles`
 * (controls) and, where it can, `soft` (what the step would rather leave visible), never over the target. It prefers a spot
 * whose arrow is level with the target, then the one covering the fewest `pieces` (empty board over pieces; then the least
 * area of them), then the
 * side order in `prefer`, then nearness to the target's centre, stepping past obstacles. With no target, or when no side fits, it is centred in the bounds
 * (clear of the obstacles and the target where possible), with no arrow. `must` (a subset of the obstacles: the rotate
 * handles and the active outlines) is the last thing given up: when no spot clears every obstacle, the centred spot still
 * keeps clear of `must` (covering a control if it has to) before anything else is dropped.
 */
export function placeCallout(
  size: { w: number; h: number }, target: Rect | null, bounds: Rect, obstacles: readonly Rect[],
  prefer: readonly Exclude<CalloutSide, 'centre'>[], soft: readonly Rect[] = [], pieces: readonly Rect[] = [], gap = 22, must: readonly Rect[] = [],
  pointFirst = false,
): CalloutPlacement {
  const firm = [...obstacles, ...soft];
  if (target) {
    // First a side where the arrow points straight at the target; failing that, any side that fits; and only then one that
    // covers the `soft` rects (what the step would rather leave visible, such as the piece being turned). Within a pass, the
    // side whose best spot covers the fewest pieces wins (ties: the order of `prefer`). `pointFirst` (v1.5.0: a button in a
    // row of buttons, where an arrow that is not level with it would point at its neighbour): pointing straight at the target
    // comes before keeping the `soft` rects clear (the fewest pieces, then the least of them, are still covered).
    const passes: [boolean, readonly Rect[]][] = pointFirst
      ? [[true, firm], [true, obstacles], [false, firm], [false, obstacles]]
      : [[true, firm], [false, firm], [true, obstacles], [false, obstacles]];
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
  const giveUp = [...soft, ...pieces];
  const r = centred(size, bounds, [...firm, ...t]) ?? centred(size, bounds, [...obstacles, ...t], giveUp)
    ?? (must.length ? centred(size, bounds, [...must, ...t], giveUp) : null) ?? (must.length ? centred(size, bounds, must, giveUp) : null) ?? centred(size, bounds, t)
    ?? { x: clamp(bounds.x + (bounds.w - size.w) / 2, bounds.x, bounds.x + bounds.w), y: clamp(bounds.y + (bounds.h - size.h) / 2, bounds.y, bounds.y + bounds.h) };
  return { x: r.x, y: r.y, side: 'centre', arrow: 0 };
}
