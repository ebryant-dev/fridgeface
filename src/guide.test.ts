import { describe, expect, it } from 'vitest';
import {
  BESIDE_ORDER, GUIDE_COPY, GUIDE_IDLE, GUIDE_LETTER, GUIDE_STORAGE_KEY, GUIDE_WORD, activeOutlines, answerAsk, askGuide, welcomeGuide, besideRect, besideSpot,
  cSequence, chooseWord, currentBatch, endGuide, nextAction, fitZoom, freeRect, frameBeside, guideBuilt, guideClearPlan, guideClickIn, guideProgress, guideRunning, guideWanted, landingOutline, moveLetter,
  nextOutline, observeGuide, placeCallout, readGuideOff, recordBuilt, rectsOverlap, shownOutline, startGuide, writeGuideOff, type GuideState,
  type GuideStorage, type GuideWorld, type Rect,
} from './guide';
import type { Outline, OutlinePiece } from './outline';
import { bringForwardOverlapping } from './selection';
import { stackCheck, stackPrompt } from './stacking';
import { History } from './history';

// Synthetic shapes: every shape is 100 board units across, so the click-in tolerance is 18 units and 12 degrees.
const world = (pieces: readonly OutlinePiece[]): GuideWorld => ({ pieces, sizeOf: () => 100 });
const pc = (id: string, shapeId: string, x = 0, y = 0, rotation = 0): OutlinePiece => ({ id, shapeId, x, y, rotation });
const ol = (shapeId: string, x: number, y: number, rotation = 0): Outline => ({ shapeId, x, y, rotation });

/** A "c": black oval, white oval on it, wedge at 111.03 degrees (like lower-c-1). */
const C = [ol('positive-round', 0, 0), ol('negative-round', 0, 0), ol('wedge', 113, 2, 111.03)];
/** A small "word": a stem, a round, a negative round that must sit ABOVE the round, and a wedge. */
const WORD = [ol('positive-stem', 500, 0, -5), ol('positive-round', 600, 0), ol('negative-round', 605, 0), ol('wedge', 700, 30, 40)];
const on = (id: string, o: Outline): OutlinePiece => ({ id, ...o });

describe('copy v4', () => {
  it('is the approved wording, word for word', () => {
    expect(GUIDE_COPY.step1).toBe('Drag the wedge onto the fridge.');
    expect(GUIDE_COPY.step1b).toBe('Now turn it with the round handle to fit.');
    expect(GUIDE_COPY.step1bTouch).toBe('Now turn it with the round handle to fit, or twist with two fingers.');
    expect(GUIDE_COPY.step2).toBe('Now drag the black oval into place.');
    expect(GUIDE_COPY.step3).toBe('Now drag the white oval onto it.');
    expect(GUIDE_COPY.step4).toBe('Bring the wedge forward so it cuts into the black.');
    expect([GUIDE_COPY.step0, GUIDE_COPY.clearStart, GUIDE_COPY.keepMine]).toEqual(['Start on a clean fridge?', 'Clear and start', 'Keep my pieces']);
    expect([GUIDE_COPY.step5, GUIDE_COPY.step5Ask]).toEqual(["That's a c.", 'Do you want to continue the tutorial?']);
    expect([GUIDE_COPY.guideMe, GUIDE_COPY.clearFree]).toEqual(['Yes, continue', 'No, clear for free play']);
    expect(GUIDE_COPY.step6).toBe('Fill in the outlines to spell "create".');
    expect(GUIDE_COPY.progress(7, 32)).toBe('7 of 32');
    expect(GUIDE_COPY.stackBack).toBe('Send it back so it sits behind.');
    expect(GUIDE_COPY.stackForward).toBe('Bring it forward so it sits in front.');
    expect(GUIDE_COPY.step7).toBe("Great work! Now you're ready to create on your own.");
    expect([GUIDE_COPY.startFresh, GUIDE_COPY.keepIt, GUIDE_COPY.skip, GUIDE_COPY.dontShow, GUIDE_COPY.next, GUIDE_COPY.replay])
      .toEqual(['Start fresh', 'Keep it', 'Exit guide', "Don't show again", 'Next', 'Show guide']);
    expect([GUIDE_COPY.welcome, GUIDE_COPY.yes, GUIDE_COPY.no]).toEqual(['Would you like a tutorial?', 'Yes', 'No']);
    expect(GUIDE_LETTER).toEqual({ char: 'c', variant: 1 });
    expect(GUIDE_WORD).toEqual({ text: 'create', variant: 1 });
  });
});

describe('step machine v4: the c, wedge first, teaches stacking (steps 1 to 5)', () => {
  // C is [black, white, wedge] (the suggestion's own order, bottom first); the guide asks for the wedge first.
  const white = on('b', C[1]), black = on('a', C[0]), wedge = on('w', C[2]);

  it('starts at step 1 with ONE outline showing (the wedge), on a blank board', () => {
    const s = startGuide(C, world([]));
    expect(s.step).toBe(1);
    expect(s.phase).toBe('c');
    expect(activeOutlines(s)).toEqual([2]);
    expect(cSequence(C)).toEqual([2, 0, 1]);
    expect(cSequence([C[0], C[1]]), 'without all three: their own order').toEqual([0, 1]);
    expect(startGuide([], world([]))).toBe(GUIDE_IDLE); // no c: no guide
  });

  it('1 wedge -> 2 black (lands on top of it) -> 3 white -> 4 bring the wedge forward -> 5', () => {
    let s = startGuide(C, world([]));
    s = observeGuide(s, world([wedge]));
    expect([s.step, activeOutlines(s), s.stack, s.turn]).toEqual([2, [0], null, null]);
    s = observeGuide(s, world([wedge, black])); // a newly added piece is on top
    expect([s.step, activeOutlines(s), s.stack]).toEqual([3, [1], null]);
    s = observeGuide(s, world([wedge, black, white]));
    expect([s.step, activeOutlines(s)]).toEqual([4, []]);
    expect(s.stack, 'step 4 prompts Bring forward on the wedge, one press (past the black oval)').toEqual({ id: 'w', dir: 'forward', presses: 1, order: ['a', 'w', 'b'] });
    expect(guideProgress(s).done, 'the wedge and the black oval are mis-stacked').toBe(1);
    expect(nextAction(s)).toEqual({ kind: 'stack', prompt: s.stack });
    // The overlap-aware Bring forward steps past the black oval in one press.
    const ov = (a: string, b: string) => (a === 'w') !== (b === 'w') ? a === 'a' || b === 'a' : true;
    expect(bringForwardOverlapping(['w', 'a', 'b'], new Set(['w']), ov)).toEqual(['a', 'w', 'b']);
    s = observeGuide(s, world([black, wedge, white]));
    expect([s.step, activeOutlines(s), s.stack]).toEqual([5, [], null]);
    s = observeGuide(s, world([black, white, wedge])); // above the white oval too: also right
    expect(s.step).toBe(5);
    expect(observeGuide(s, world([black, white, wedge]))).toBe(s); // unchanged: same object
  });

  it('step 4 counts the wedge and the black oval as overlapping whatever the geometry says, and steps past the visitor\'s own pieces', () => {
    const mine = pc('m', 'positive-stem', 5000, 0);
    const s = observeGuide(startGuide(C, world([])), { pieces: [wedge, mine, black, white], sizeOf: () => 100, overlaps: () => false });
    expect([s.step, s.stack?.id, s.stack?.dir, s.stack?.presses]).toEqual([4, 'w', 'forward', 1]);
  });

  it('when the wedge overlaps the white oval too, it must pass both: more than one press', () => {
    const s = observeGuide(startGuide(C, world([])), { pieces: [wedge, black, white], sizeOf: () => 100, overlaps: () => true });
    expect([s.step, s.stack?.id, s.stack?.dir, s.stack?.presses, s.stack?.order]).toEqual([4, 'w', 'forward', 2, ['a', 'b', 'w']]);
  });

  it('the wedge first, then any other c piece the visitor mis-stacked (the plain prompt)', () => {
    let s = observeGuide(startGuide(C, world([])), world([wedge, white, black])); // the white oval under the black one too
    expect([s.step, s.stack?.id, s.stack?.dir]).toEqual([4, 'w', 'forward']);
    s = observeGuide(s, world([white, black, wedge])); // the wedge brought forward: the ovals are still the wrong way round
    expect(s.step).toBe(4);
    expect(s.stack?.id).not.toBe('w');
  });

  it('sending the wedge back again goes back to step 4 (derived from the board)', () => {
    const s5 = observeGuide(startGuide(C, world([])), world([black, wedge, white]));
    expect(s5.step).toBe(5);
    expect(observeGuide(s5, world([wedge, black, white])).step).toBe(4);
  });

  it('a piece merely near, or of another shape, fills nothing', () => {
    const s = startGuide(C, world([]));
    expect(observeGuide(s, world([pc('w', 'wedge', 118, 2, 111.03)])).step).toBe(1); // near but not exactly on it
    expect(observeGuide(s, world([pc('x', 'negative-round', 113, 2, 111.03)])).step).toBe(1); // exactly there, wrong shape
  });

  it('1a: the wedge\'s outline is drawn at its LANDING angle (0) at the true position; 1b (close, needs turning): at its true angle', () => {
    let s = startGuide(C, world([]));
    expect([s.step, s.turn]).toEqual([1, null]);
    expect(shownOutline(s, 2)).toEqual({ ...C[2], rotation: 0 });
    expect(landingOutline(C[2])).toEqual({ shapeId: 'wedge', x: 113, y: 2, rotation: 0 });
    s = observeGuide(s, world([pc('w', 'wedge', 113, 2, 0)])); // clicked into the landing outline, unturned
    expect([s.step, s.turn]).toEqual([1, 'w']);
    expect(activeOutlines(s), 'the same outline').toEqual([2]);
    expect(shownOutline(s, 2), 'now at its true angle').toEqual(C[2]);
    s = observeGuide(s, world([pc('w', 'wedge', 400, 0, 0)])); // moved away: back to 1a
    expect([s.step, s.turn, shownOutline(s, 2).rotation]).toEqual([1, null, 0]);
    expect(shownOutline(observeGuide(s, world([wedge])), 0), 'other steps: the outline itself').toEqual(C[0]);
  });

  it('robust: a clicked-in piece moved away or deleted shows its outline again (the step goes back, never past a button)', () => {
    let s = observeGuide(startGuide(C, world([])), world([black, white, wedge]));
    expect(s.step).toBe(5);
    s = observeGuide(s, world([{ ...black, x: 300 }, white, wedge])); // the black oval moved off
    expect([s.step, activeOutlines(s)]).toEqual([2, [0]]);
    s = observeGuide(s, world([black, white])); // the wedge deleted
    expect([s.step, activeOutlines(s)]).toEqual([1, [2]]);
  });

  it('undo consistency: undoing a click-in shows the outline again; undoing the bring-forward returns to step 4; redo moves on again', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    let s = startGuide(C, world([]));
    const dropped = [pc('w', 'wedge', 120, 0, 0)]; // from the tray: rotation 0, near the landing outline
    h.record(dropped); // the drag
    let r = guideClickIn(s, world(dropped), ['w'])!;
    expect(r).toEqual({ placements: [{ id: 'w', x: 113, y: 2, rotation: 0, outline: 2 }] });
    h.amend(dropped.map((p) => ({ ...p, ...r.placements[0] }))); // the click-in: the same undo step
    s = observeGuide(s, world(h.present));
    expect([s.step, s.turn]).toEqual([1, 'w']);
    const turned = [{ ...h.present[0], rotation: 104 }];
    h.record(turned); // turned with the handle, about its centroid: still at (113, 2)
    r = guideClickIn(s, world(turned), ['w'])!;
    expect(r).toEqual({ placements: [{ id: 'w', x: 113, y: 2, rotation: 111.03, outline: 2 }] });
    h.amend([{ ...turned[0], ...r.placements[0] }]);
    s = observeGuide(s, world(h.present));
    expect(s.step).toBe(2);
    h.record([wedge, black]);
    s = observeGuide(s, world(h.present));
    h.record([wedge, black, white]);
    s = observeGuide(s, world(h.present));
    expect(s.step).toBe(4);
    h.record([black, wedge, white]); // Bring forward
    s = observeGuide(s, world(h.present));
    expect(s.step).toBe(5);
    s = observeGuide(s, world(h.undo()!));
    expect([s.step, s.stack?.id]).toEqual([4, 'w']);
    s = observeGuide(s, world(h.undo()!));
    s = observeGuide(s, world(h.undo()!));
    expect(s.step).toBe(2);
    s = observeGuide(s, world(h.undo()!)); // the turn undone: in position, unturned again
    expect([s.step, s.turn]).toEqual([1, 'w']);
    s = observeGuide(s, world(h.undo()!)); // ONE undo per release: back to before the first drag
    expect([s.step, s.turn, h.present]).toEqual([1, null, []]);
    s = observeGuide(s, world(h.redo()!));
    expect([s.step, s.turn]).toEqual([1, 'w']);
  });
});

describe('click-in (guide only)', () => {
  const black = on('a', C[0]), wedge = on('w', C[2]);
  const at3 = () => observeGuide(startGuide(C, world([])), world([wedge, black]));

  it('a released piece of the right shape within tolerance clicks EXACTLY into the active outline (position and angle only)', () => {
    const r = guideClickIn(at3(), world([wedge, black, pc('b', 'negative-round', 10, -12, 7)]), ['b']);
    expect(r).toEqual({ placements: [{ id: 'b', x: 0, y: 0, rotation: 0, outline: 1 }] });
  });

  it('the wrong shape, too far, or the wrong angle stays where it was dropped', () => {
    const s = at3();
    const base = [wedge, black];
    expect(guideClickIn(s, world([...base, pc('x', 'positive-round', 1, 1)]), ['x'])).toBeNull();
    expect(guideClickIn(s, world([...base, pc('x', 'negative-round', 19, 0)]), ['x'])).toBeNull();
    expect(guideClickIn(s, world([...base, pc('x', 'negative-round', 0, 0, 13)]), ['x'])).toBeNull();
  });

  it('only the ACTIVE outline accepts: the black oval does not click in during step 1; nothing clicks in at step 4', () => {
    const s = startGuide(C, world([]));
    expect(guideClickIn(s, world([pc('a', 'positive-round', 0, 0)]), ['a'])).toBeNull();
    const s4 = observeGuide(s, world([wedge, black, on('b', C[1])]));
    expect(s4.step).toBe(4);
    expect(guideClickIn(s4, world([wedge, black, on('b', C[1]), pc('x', 'wedge', 113, 2, 111)]), ['x'])).toBeNull();
  });

  it('the wedge: within 12 degrees of 111.03 clicks in (position and angle), wrapping included', () => {
    const s = startGuide(C, world([]));
    const at = (r: number) => guideClickIn(s, world([pc('w', 'wedge', 115, 4, r)]), ['w']);
    expect(at(100)?.placements[0]).toEqual({ id: 'w', x: 113, y: 2, rotation: 111.03, outline: 2 });
    expect(at(122)).not.toBeNull();
    expect(at(-252)?.placements[0].rotation, '-252 is 108 the other way round').toBe(111.03);
  });

  it('step 1a: a wedge near the LANDING outline (angle near 0) clicks into its position only, keeping its angle', () => {
    const s = startGuide(C, world([]));
    const at = (x: number, y: number, r: number) => guideClickIn(s, world([pc('w', 'wedge', x, y, r)]), ['w']);
    expect(at(120, 0, 0)).toEqual({ placements: [{ id: 'w', x: 113, y: 2, rotation: 0, outline: 2 }] });
    expect(at(105, 10, -9)?.placements[0], 'within the angle tolerance of 0: its own angle kept').toEqual({ id: 'w', x: 113, y: 2, rotation: -9, outline: 2 });
    expect(at(120, 0, 30), 'neither near 0 nor near the true angle: stays').toBeNull();
    expect(at(98, 0, 98), 'between the two: stays').toBeNull();
    expect(at(140, 0, 0), 'too far (27 units; the tolerance is 18)').toBeNull();
    expect(at(113, 2, 0), 'already exactly there: nothing to click').toBeNull();
    expect(guideClickIn(s, world([pc('x', 'negative-round', 113, 2, 0)]), ['x']), 'only the wedge').toBeNull();
    // Only in step 1: a wedge near the landing pose clicks nowhere later (step 2's outline is the black oval).
    const s2 = observeGuide(s, world([wedge]));
    expect(guideClickIn(s2, world([wedge, pc('x', 'wedge', 120, 0, 0)]), ['x'])).toBeNull();
  });

  it('the landing pose turns into the true outline: a piece turns about its centroid (x, y), so only the angle changes', () => {
    const o = C[2], land = landingOutline(o);
    expect([land.x, land.y]).toEqual([o.x, o.y]);
    // Turned in place from the landing pose to the outline's angle, the piece sits exactly on the outline.
    expect(observeGuide(startGuide(C, world([])), world([{ id: 'w', ...land, rotation: o.rotation }])).step).toBe(2);
  });

  it('NO snapping when the guide is inactive: idle, ended, or on a step without outlines', () => {
    const exact = world([on('b', C[1])]);
    expect(guideClickIn(GUIDE_IDLE, exact, ['b'])).toBeNull();
    expect(guideClickIn(endGuide(), world([pc('b', 'negative-round', 1, 1)]), ['b'])).toBeNull();
    const done = [on('a', C[0]), on('b', C[1]), on('w', C[2])];
    const s5 = observeGuide(startGuide(C, world([])), world(done));
    expect(s5.step).toBe(5);
    expect(guideClickIn(s5, world([...done, pc('x', 'positive-round', 2, 2)]), ['x'])).toBeNull();
  });
});

describe('step machine: the word (steps 6 and 7)', () => {
  const at5 = () => observeGuide(startGuide(C, world([])), world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
  // WORD's overlapping pairs (rough overlap, 100-unit shapes): the round and its negative round (1, 2), and the negative
  // round and the wedge (2, 3). The stem (0) overlaps nothing. Its batches (v1.4.0): [0, 1], then [2], then [3].

  it('Guide me: from step 5 only; the first batch shows; done = placed AND stacked right; progress N of M; then step 7', () => {
    expect(chooseWord(startGuide(C, world([])), WORD, world([])).step, 'not from step 1').toBe(1);
    let s = chooseWord(at5(), WORD, world([]));
    expect([s.step, s.phase, s.batches, activeOutlines(s), guideProgress(s)]).toEqual([6, 'word', [[0, 1], [2], [3]], [0, 1], { done: 0, total: 4 }]);
    // (Out of the plan: the last piece first, as a load or a hand-placed piece could put it; the board is read as it is.)
    s = observeGuide(s, world([on('w', WORD[3])]));
    expect([s.step, activeOutlines(s), guideProgress(s), s.stack]).toEqual([6, [0, 1], { done: 1, total: 4 }, null]);
    s = observeGuide(s, world([on('w', WORD[3]), on('n', WORD[2])])); // the negative round lands ON TOP of the wedge
    expect(guideProgress(s).done, 'placed but mis-stacked: neither counts').toBe(0);
    expect(s.filled.filter(Boolean)).toHaveLength(2);
    expect(s.stack).toEqual({ id: 'n', dir: 'back', presses: 1, order: ['n', 'w'] });
    s = observeGuide(s, world([on('n', WORD[2]), on('w', WORD[3]), on('s', WORD[0])]));
    expect([guideProgress(s).done, s.stack]).toEqual([3, null]);
    s = observeGuide(s, world([on('n', WORD[2]), on('w', WORD[3]), on('s', WORD[0]), on('r', WORD[1])])); // the round on top of its negative
    expect([s.step, guideProgress(s).done, s.stack?.id, s.stack?.dir]).toEqual([6, 2, 'r', 'back']);
    expect(s.stack?.presses, 'past the stem? it does not overlap: one press past the negative round').toBe(1);
    s = observeGuide(s, world([on('r', WORD[1]), on('n', WORD[2]), on('w', WORD[3]), on('s', WORD[0])]));
    expect([s.step, activeOutlines(s), guideProgress(s), s.stack]).toEqual([7, [], { done: 4, total: 4 }, null]);
  });

  it('stackCheck: only overlapping pairs matter; a non-overlapping pair in the "wrong" order is ignored', () => {
    const pieces = [on('s', WORD[0]), on('r', WORD[1])];
    // Stem (0) above?.. no: the round (1) is below the stem (0) here, the reverse of the word, but they do not overlap.
    expect(stackCheck(['s', 'r', null, null], [pieces[1], pieces[0]], (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 100)).toEqual({ done: [true, true, false, false], wrong: [] });
    expect(stackCheck(['s', 'r', null, null], [pieces[1], pieces[0]], () => true)).toEqual({ done: [false, false, false, false], wrong: ['s', 'r'] });
  });

  it('never goes back past Guide me: an emptied board (or an undo bringing the c back) stays on the word', () => {
    let s = chooseWord(at5(), WORD, world([]));
    s = observeGuide(s, world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
    expect([s.step, s.phase]).toEqual([6, 'word']);
    s = observeGuide(s, world(WORD.map((o, i) => on(`p${i}`, o))));
    expect(s.step).toBe(7);
    s = observeGuide(s, world(WORD.slice(1).map((o, i) => on(`p${i + 1}`, o)))); // a piece deleted at step 7
    expect([s.step, activeOutlines(s)]).toEqual([6, [0]]);
  });

  it('the turning hint in step 6: a piece close to an outline of the current batch but mis-angled (only the current batch)', () => {
    const s0 = chooseWord(at5(), WORD, world([]));
    expect(observeGuide(s0, world([pc('x', 'wedge', 705, 30, 0)])).turn, 'the wedge is not in the current batch yet').toBeNull();
    const before = [on('s', WORD[0]), on('r', WORD[1]), on('n', WORD[2])];
    const s = observeGuide(s0, world([...before, pc('x', 'wedge', 705, 30, 0)]));
    expect([s.step, currentBatch(s), s.turn]).toEqual([6, 2, 'x']);
  });

  it('no auto-reorder on click-in: a positive clicked in after its negative stays on top, and is prompted instead', () => {
    let s = chooseWord(at5(), WORD, world([]));
    const neg = on('n', WORD[2]);
    s = observeGuide(s, world([neg]));
    const board = [neg, pc('r', 'positive-round', 604, 3)]; // the round, added later, is on top
    const r = guideClickIn(s, world(board), ['r'])!;
    expect(r).toEqual({ placements: [{ id: 'r', x: 600, y: 0, rotation: 0, outline: 1 }] });
    s = observeGuide(s, world([neg, on('r', WORD[1])]));
    expect([guideProgress(s).done, s.stack?.id, s.stack?.dir]).toEqual([0, 'r', 'back']);
  });

  it('two pieces released together each click into their own outline (both in the current batch)', () => {
    const s = chooseWord(at5(), WORD, world([]));
    const r = guideClickIn(s, world([pc('s', 'positive-stem', 502, 1, -3), pc('r', 'positive-round', 603, 2, 4)]), ['s', 'r'])!;
    expect(r.placements.map((p) => [p.id, p.outline])).toEqual([['s', 0], ['r', 1]]);
  });

  it('Next: fills the lowest active outline, or (first) fixes the prompted piece\'s stacking; nothing on steps 5 and 7', () => {
    expect(nextOutline(startGuide(C, world([])))).toBe(2);
    expect(nextAction(startGuide(C, world([])))).toEqual({ kind: 'place', outline: 2 });
    expect(nextAction(at5())).toBeNull();
    let s = observeGuide(chooseWord(at5(), WORD, world([])), world([on('s', WORD[0])]));
    expect(nextAction(s)).toEqual({ kind: 'place', outline: 1 });
    s = observeGuide(s, world([on('s', WORD[0]), on('w', WORD[3]), on('n', WORD[2])]));
    const a = nextAction(s);
    expect(a?.kind).toBe('stack');
    // Next applies the order the presses would give: the stacking is fixed, and progress counts it.
    const fixed = a!.kind === 'stack' ? a!.prompt.order : [];
    const byId = new Map([['s', on('s', WORD[0])], ['w', on('w', WORD[3])], ['n', on('n', WORD[2])]]);
    s = observeGuide(s, world(fixed.map((id) => byId.get(id)!)));
    expect([s.stack, guideProgress(s).done]).toEqual([null, 3]);
  });

  it('undo/redo keep it consistent: undoing a fix brings the prompt back, undoing the placement removes it', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    let s = chooseWord(at5(), WORD, world([]));
    h.record([on('n', WORD[2])]);
    s = observeGuide(s, world(h.present));
    h.record([on('n', WORD[2]), on('r', WORD[1])]); // the round lands on top of its negative round
    s = observeGuide(s, world(h.present));
    expect([s.stack?.id, guideProgress(s).done]).toEqual(['r', 0]);
    h.record([on('r', WORD[1]), on('n', WORD[2])]); // Send backward
    s = observeGuide(s, world(h.present));
    expect([s.stack, guideProgress(s).done]).toEqual([null, 2]);
    s = observeGuide(s, world(h.undo()!));
    expect([s.stack?.id, s.stack?.dir, guideProgress(s).done]).toEqual(['r', 'back', 0]);
    s = observeGuide(s, world(h.undo()!));
    expect([s.stack, guideProgress(s).done, s.recent]).toEqual([null, 1, ['n']]);
    s = observeGuide(s, world(h.redo()!));
    expect(s.stack?.id).toBe('r');
    s = observeGuide(s, world(h.redo()!));
    expect([s.stack, guideProgress(s).done]).toEqual([null, 2]);
  });

  it('without the word, step 5 cannot choose it', () => {
    const s5: GuideState = at5();
    expect(chooseWord(s5, [], world([]))).toBe(s5);
  });
});

describe('stackPrompt: direction, fewest presses, most recent first', () => {
  // Abstract pieces on outlines 0..n-1 (bottom first); `ov` says which pairs overlap.
  const P = (ids: string[]) => ids.map((id) => pc(id, 'x', 0, 0));
  const pairs = (list: string[][]) => (a: OutlinePiece, b: OutlinePiece) => list.some(([x, y]) => (x === a.id && y === b.id) || (x === b.id && y === a.id));

  it('a piece on top that belongs underneath: Send it back, as many presses as overlapping pieces it must pass', () => {
    // Word order a, b, c, d (outline indices). Board: a, b, c, then d... no: d is placed at index 0 but sits on top.
    const filled = ['d', 'a', 'b', 'c'];
    const ov = pairs([['d', 'a'], ['d', 'b'], ['d', 'c'], ['a', 'b']]);
    const p = stackPrompt(filled, P(['a', 'b', 'c', 'd']), ov, ['a', 'b', 'c', 'd'])!;
    expect([p.id, p.dir, p.presses, p.order]).toEqual(['d', 'back', 3, ['d', 'a', 'b', 'c']]);
  });

  it('a non-overlapping piece in between costs no press (overlap-aware)', () => {
    const filled = ['d', 'a', 'b', 'c'];
    const ov = pairs([['d', 'a'], ['d', 'c']]); // b does not overlap d
    const p = stackPrompt(filled, P(['a', 'b', 'c', 'd']), ov, ['a', 'b', 'c', 'd'])!;
    expect([p.id, p.dir, p.presses]).toEqual(['d', 'back', 2]);
  });

  it('the direction needing fewer presses wins when both could fix it', () => {
    // Word: x (0) below y (1) below z (2), all overlapping. Board: y, z, x. The most recent placed is z.
    // z: must be above x and y -> Bring forward 1 press. Ties on recency aside, x (most recent) is checked first:
    const ov = () => true;
    const p = stackPrompt(['x', 'y', 'z'], P(['y', 'z', 'x']), ov, ['y', 'z', 'x'])!;
    expect([p.id, p.dir, p.presses], 'x: Send back past z and y is 2; nothing forward').toEqual(['x', 'back', 2]);
    // Board z, x, y with z most recent: z must go forward past x and y (2), never back (already at the bottom).
    const q = stackPrompt(['x', 'y', 'z'], P(['z', 'x', 'y']), ov, ['x', 'y', 'z'])!;
    expect([q.id, q.dir, q.presses]).toEqual(['z', 'forward', 2]);
    // Board x, z, y with y most recent: y must be below z: back 1 (forward is impossible: it is on top).
    const r = stackPrompt(['x', 'y', 'z'], P(['x', 'z', 'y']), ov, ['x', 'z', 'y'])!;
    expect([r.id, r.dir, r.presses]).toEqual(['y', 'back', 1]);
    // Same board, z most recent: z must be above y: forward 1.
    const t = stackPrompt(['x', 'y', 'z'], P(['x', 'z', 'y']), ov, ['x', 'y', 'z'])!;
    expect([t.id, t.dir, t.presses]).toEqual(['z', 'forward', 1]);
  });

  it('several mis-stacked: the most recently placed one first', () => {
    const ov = pairs([['a', 'b'], ['c', 'd']]);
    // Word a, b, c, d. Board: b, a, d, c: both pairs wrong. Placed in the order b, a, d, c.
    const p = stackPrompt(['a', 'b', 'c', 'd'], P(['b', 'a', 'd', 'c']), ov, ['b', 'a', 'd', 'c'])!;
    expect([p.id, p.dir]).toEqual(['c', 'back']);
    const q = stackPrompt(['a', 'b', 'c', 'd'], P(['b', 'a', 'd', 'c']), ov, ['d', 'c', 'b', 'a'])!;
    expect([q.id, q.dir]).toEqual(['a', 'back']);
    expect(stackPrompt(['a', 'b', 'c', 'd'], P(['a', 'b', 'c', 'd']), ov, [])).toBeNull();
  });

  it('a tangle (no single piece can be put right): the shortest press sequence is prompted, one piece at a time', () => {
    // Word a (0), b (1), c (2), d (3); overlaps a-b, b-c, c-d only. Board c, d, a, b: b is above c but belongs below it. b
    // sent back passes a first (wrong then); c brought forward passes d first (wrong then). Three presses fix it: b back
    // twice (past a, then c), then a back once. The prompt is the first piece's run; the rest is prompted after.
    const ov = pairs([['a', 'b'], ['b', 'c'], ['c', 'd']]);
    const p = stackPrompt(['a', 'b', 'c', 'd'], P(['c', 'd', 'a', 'b']), ov, ['c', 'd', 'a', 'b'])!;
    expect([p.id, p.dir, p.presses, p.order]).toEqual(['b', 'back', 2, ['b', 'c', 'd', 'a']]);
    const q = stackPrompt(['a', 'b', 'c', 'd'], P(p.order), ov, ['c', 'd', 'a', 'b'])!;
    expect([q.id, q.dir, q.presses, q.order]).toEqual(['a', 'back', 1, ['a', 'b', 'c', 'd']]);
  });

  it('a piece that cannot be put right by itself yields to one that can', () => {
    // Word: l (0), p (1), u (2). p overlaps l and u; l and u do not overlap each other. Board: u, l, p (p on top). p must
    // sit above l and below u, but u is below l: p alone cannot. Moving u forward past p fixes u's own pair.
    const ov = pairs([['p', 'l'], ['p', 'u']]);
    const s = stackPrompt(['l', 'p', 'u'], P(['u', 'l', 'p']), ov, ['l', 'u', 'p'])!;
    expect([s.id, s.dir, s.presses]).toEqual(['u', 'forward', 1]);
  });
});

describe('when it shows, Skip and "Don\'t show again"', () => {
  const store = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const throwing: GuideStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };

  it('shows on every visit unless disabled (no-guide), authoring, or turned off', () => {
    expect(guideWanted({ disabled: false, authoring: false, off: false })).toBe(true);
    expect(guideWanted({ disabled: true, authoring: false, off: false })).toBe(false);
    expect(guideWanted({ disabled: false, authoring: true, off: false })).toBe(false);
    expect(guideWanted({ disabled: false, authoring: false, off: true })).toBe(false);
  });

  it('replay (Show guide) ignores "Don\'t show again" but not no-guide or author mode', () => {
    expect(guideWanted({ disabled: false, authoring: false, off: true }, true)).toBe(true);
    expect(guideWanted({ disabled: true, authoring: false, off: true }, true)).toBe(false);
    expect(guideWanted({ disabled: false, authoring: true, off: false }, true)).toBe(false);
  });

  it('"Don\'t show again" stores fridgeface:guide:v2 = off, and reads back', () => {
    const s = store();
    expect(GUIDE_STORAGE_KEY).toBe('fridgeface:guide:v2');
    expect(readGuideOff(() => s)).toBe(false);
    expect(writeGuideOff(() => s)).toBe(true);
    expect(s.m.get('fridgeface:guide:v2')).toBe('off');
    expect(readGuideOff(() => s)).toBe(true);
    expect(readGuideOff(() => store({ 'fridgeface:guide:v2': 'on' }))).toBe(false);
  });

  it('replaying does not unset it', () => {
    const s = store({ 'fridgeface:guide:v2': 'off' });
    const off = readGuideOff(() => s);
    expect(guideWanted({ disabled: false, authoring: false, off }, true)).toBe(true);
    expect(startGuide(C, world([])).step).toBe(1);
    expect(readGuideOff(() => s)).toBe(true);
  });

  it('storage failure behaves as not set: the guide shows, and writing reports failure without throwing', () => {
    expect(readGuideOff(() => throwing)).toBe(false);
    expect(readGuideOff(() => { throw new Error('SecurityError'); })).toBe(false); // even reaching localStorage throws
    expect(readGuideOff(() => null)).toBe(false);
    expect(writeGuideOff(() => throwing)).toBe(false);
    expect(writeGuideOff(() => { throw new Error('SecurityError'); })).toBe(false);
    expect(writeGuideOff(() => undefined)).toBe(false);
    expect(guideWanted({ disabled: false, authoring: false, off: readGuideOff(() => throwing) })).toBe(true);
  });

  it('Skip ends it for this visit (it comes back on the next one)', () => {
    const s = startGuide(C, world([]));
    expect(endGuide().step).toBe(0);
    expect(s.step).toBe(1);
    const st = store();
    expect(guideWanted({ disabled: false, authoring: false, off: readGuideOff(() => st) })).toBe(true); // nothing stored by Skip
  });
});

describe('placeCallout', () => {
  it('never covers a rotate handle (or an active outline) passed as `must`, even when nothing clears every obstacle', () => {
    const size = { w: 100, h: 50 };
    const bounds = { x: 0, y: 0, w: 300, h: 200 };
    const control = { x: 0, y: 0, w: 150, h: 200 }; // a dock over the left half
    const handle = { x: 160, y: 0, w: 140, h: 200 }; // a handle's hit box (and margin), stretched for the test
    // No spot clears both: the old last resort was the plain centre, over the handle.
    const p = placeCallout(size, null, bounds, [control, handle], [], [], [], 22, [handle]);
    expect(rectsOverlap({ x: p.x, y: p.y, ...size }, handle)).toBe(false);
    expect(p.side).toBe('centre');
    // Without `must` it is the old behaviour.
    const q = placeCallout(size, null, bounds, [control, handle], []);
    expect(rectsOverlap({ x: q.x, y: q.y, ...size }, handle)).toBe(true);
    // With a target: a handle beside the target pushes the callout to another side.
    const t = { x: 140, y: 120, w: 20, h: 20 };
    const h2 = { x: 120, y: 40, w: 60, h: 60 }; // right above the target
    const r = placeCallout(size, t, bounds, [h2], ['above', 'below', 'left', 'right'], [], [], 22, [h2]);
    expect(rectsOverlap({ x: r.x, y: r.y, ...size }, h2)).toBe(false);
  });

  const bounds: Rect = { x: 0, y: 0, w: 800, h: 600 };
  const size = { w: 200, h: 80 };
  const within = (r: Rect, b: Rect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;

  it('sits on the preferred side, centred on the target, clear of it, with the arrow at the target', () => {
    const t = { x: 380, y: 590, w: 40, h: 10 };
    const p = placeCallout(size, t, bounds, [], ['above']);
    expect(p.side).toBe('above');
    expect(p.x).toBe(300);
    expect(p.y + size.h).toBeLessThanOrEqual(t.y - 20);
    expect(p.arrow).toBe(100);
  });

  it('steps past obstacles, and stays inside the bounds', () => {
    const t = { x: 380, y: 590, w: 40, h: 10 };
    const dock = { x: 250, y: 500, w: 300, h: 60 };
    const p = placeCallout(size, t, bounds, [dock], ['above']);
    const r = { ...size, x: p.x, y: p.y };
    expect(rectsOverlap(r, dock)).toBe(false);
    expect(rectsOverlap(r, t)).toBe(false);
    expect(within(r, bounds)).toBe(true);
  });

  it('falls back to the next side, then to the centre (never over the target)', () => {
    const t = { x: 300, y: 10, w: 40, h: 40 }; // no room above
    const p = placeCallout(size, t, bounds, [], ['above', 'below']);
    expect(p.side).toBe('below');
    const huge = { x: 0, y: 0, w: 800, h: 600 };
    const c = placeCallout(size, { x: 390, y: 290, w: 20, h: 20 }, bounds, [], []);
    expect(c.side).toBe('centre');
    expect(rectsOverlap({ ...size, x: c.x, y: c.y }, { x: 390, y: 290, w: 20, h: 20 })).toBe(false);
    expect(placeCallout(size, null, huge, [], ['above']).side).toBe('centre');
  });

  it('clamps along the edge: a target near the left edge keeps the callout inside, the arrow still at the target', () => {
    const t = { x: 0, y: 300, w: 40, h: 40 };
    const p = placeCallout(size, t, bounds, [], ['above']);
    expect(p.x).toBe(0);
    expect(p.arrow).toBe(20);
  });

  it('prefers a side where the arrow points straight at the target over one that would have to shift past it', () => {
    const t = { x: 380, y: 150, w: 40, h: 300 };
    const bar = { x: 250, y: 0, w: 300, h: 60 }; // above the target, only a far-shifted spot is free
    const p = placeCallout(size, t, bounds, [bar], ['above', 'below']);
    expect(p.side).toBe('below');
    expect(p.arrow).toBe(100);
    // When no side lets it point straight, a shifted spot is still better than none.
    const q = placeCallout(size, { x: 380, y: 150, w: 40, h: 440 }, bounds, [bar], ['above', 'below']);
    expect(q.side).toBe('above');
    expect(rectsOverlap({ ...size, x: q.x, y: q.y }, bar)).toBe(false);
  });

  it('soft rects are avoided when possible, covered only when nothing else fits (never the target)', () => {
    const handle = { x: 380, y: 100, w: 40, h: 40 };
    const piece = { x: 360, y: 160, w: 80, h: 420 };
    const p = placeCallout(size, handle, bounds, [], ['below', 'right'], [piece]);
    expect(p.side).toBe('right'); // below would cover the piece
    const tight = { x: 200, y: 0, w: 400, h: 400 };
    const q = placeCallout(size, { x: 380, y: 10, w: 40, h: 40 }, tight, [], ['above', 'right', 'left', 'below'], [{ x: 200, y: 60, w: 400, h: 340 }]);
    expect(q.side).toBe('below');
    expect(rectsOverlap({ ...size, x: q.x, y: q.y }, { x: 380, y: 10, w: 40, h: 40 })).toBe(false);
  });

  it('prefers empty board: among spots near the target, the one covering the fewest pieces', () => {
    const tray = { x: -100, y: 0, w: 100, h: 600 };
    const word = [{ x: 20, y: 200, w: 300, h: 120 }, { x: 330, y: 220, w: 200, h: 100 }]; // pieces level with the tray's middle
    const p = placeCallout(size, tray, bounds, [], ['right'], [], word);
    expect(p.side).toBe('right');
    expect(word.some((w) => rectsOverlap({ ...size, x: p.x, y: p.y }, w))).toBe(false);
    expect(p.arrow).toBeGreaterThanOrEqual(18); // still pointing at the tray
    // With nothing to weigh, the spot nearest the target's centre wins as before.
    expect(placeCallout(size, tray, bounds, [], ['right']).y).toBe(260);
  });

  it('a tray on the left (phone landscape): to its right, arrow level with it', () => {
    const tray = { x: -100, y: 0, w: 100, h: 600 };
    const p = placeCallout(size, tray, bounds, [{ x: 0, y: 0, w: 800, h: 50 }], ['right']);
    expect(p.side).toBe('right');
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBe(260);
    expect(p.arrow).toBe(40);
  });
});

describe('step 0 (v1.2.1): a board that already has pieces', () => {
  const mine = [pc('m1', 'positive-stem', -400, 0), pc('m2', 'wedge', -300, 50, 30)];

  it('asks first: running, no outlines, nothing clicks in, the board changing does not move it on', () => {
    const s = askGuide();
    expect([s.step, s.phase, guideRunning(s), activeOutlines(s)]).toEqual([0, 'ask', true, []]);
    expect(guideRunning(GUIDE_IDLE)).toBe(false);
    expect(observeGuide(s, world(mine))).toBe(s);
    expect(guideClickIn(s, world([on('a', C[0])]), ['a'])).toBeNull();
    expect(nextOutline(s)).toBeNull();
  });

  it('Clear and start: step 1 on the blank board; their pieces are remembered as theirs, nothing is kept', () => {
    const s = answerAsk(askGuide(), 'clear', C, world([]), ['m1', 'm2']);
    expect([s.step, s.phase, s.kept, s.theirs, s.built, activeOutlines(s)]).toEqual([1, 'c', false, ['m1', 'm2'], [], [2]]);
    expect(s.letter).toBe(C);
  });

  it('Keep my pieces: step 1 with their pieces on the board, untouched; they fill nothing', () => {
    const s = answerAsk(askGuide(), 'keep', C, world(mine), ['m1', 'm2']);
    expect([s.step, s.phase, s.kept, s.theirs]).toEqual([1, 'c', true, ['m1', 'm2']]);
  });

  it('only answers from step 0', () => {
    const c = startGuide(C, world([]));
    expect(answerAsk(c, 'keep', C, world([]), [])).toBe(c);
    expect(answerAsk(GUIDE_IDLE, 'clear', C, world([]), [])).toBe(GUIDE_IDLE);
  });

  it('a skip or "Don\'t show again" at step 0 ends it', () => {
    expect(guideRunning(endGuide())).toBe(false);
  });

  it('moveLetter: an untouched c moves its outlines (their pieces came back under them); never once something is filled', () => {
    const s = answerAsk(askGuide(), 'clear', C, world([]), ['m1']);
    const moved = C.map((o) => ({ ...o, x: o.x + 1000 }));
    const t = moveLetter(s, moved, world(mine));
    expect([t.step, t.outlines, t.letter, t.theirs]).toEqual([1, moved, moved, ['m1']]);
    const filled = observeGuide(s, world([on('a', C[0])]));
    expect(moveLetter(filled, moved, world([on('a', C[0])]))).toBe(filled);
    const turning = observeGuide(s, world([pc('w', 'wedge', C[2].x, C[2].y, 0)])); // step 1b: clicked into position, unturned
    expect(turning.turn).toBe('w');
    expect(moveLetter(turning, moved, world([pc('w', 'wedge', C[2].x, C[2].y, 0)])), 'not while the wedge waits to be turned').toBe(turning);
  });
});

describe('guide-built pieces and the scoped clear (v1.2.1)', () => {
  const mine = [pc('m1', 'positive-stem', -400, 0), pc('m2', 'positive-round', -300, 0)];
  const cPieces = [on('a', C[0]), on('b', C[1]), on('w', C[2])];

  it('tracks pieces by id as they click in (or Next places them); never one of theirs, never twice', () => {
    let s = answerAsk(askGuide(), 'keep', C, world(mine), ['m1', 'm2']);
    s = recordBuilt(s, ['a']);
    s = recordBuilt(s, ['a', 'b', 'm1']);
    expect(s.built).toEqual(['a', 'b']);
    expect(recordBuilt(s, ['a'])).toBe(s);
    expect(recordBuilt(GUIDE_IDLE, ['a'])).toBe(GUIDE_IDLE);
  });

  it('guide-built = built AND still on an outline: a built piece moved off it, or a piece the visitor added, is theirs', () => {
    let s = answerAsk(askGuide(), 'keep', C, world(mine), ['m1', 'm2']);
    s = recordBuilt(s, ['a', 'b', 'w']);
    const board = [...mine, ...cPieces, pc('x', 'wedge', 900, 900)];
    expect(guideBuilt(s, board)).toEqual(['a', 'b', 'w']);
    const movedOff = [...mine, on('a', C[0]), { ...on('b', C[1]), x: 700 }, on('w', C[2])];
    expect(guideBuilt(s, movedOff)).toEqual(['a', 'w']);
  });

  it('after Keep: every guide clear removes ONLY the guide-built pieces (the c at Guide me and Clear for free play, the word at Start fresh)', () => {
    let s = answerAsk(askGuide(), 'keep', C, world(mine), ['m1', 'm2']);
    s = observeGuide(recordBuilt(s, ['a', 'b', 'w']), world([...mine, ...cPieces]));
    expect(s.step).toBe(5);
    const extra = pc('x', 'negative-stem', 2000, 0); // added by the visitor during the guide, not clicked in: theirs
    expect(guideClearPlan(s, [...mine, ...cPieces, extra])).toEqual({ all: false, ids: ['a', 'b', 'w'] });
    // Guide me, then the word filled: Start fresh removes the word's pieces only.
    let t = chooseWord(s, WORD, world([...mine, extra]));
    const wordPieces = WORD.map((o, i) => on(`k${i}`, o));
    t = observeGuide(recordBuilt(t, wordPieces.map((p) => p.id)), world([...mine, extra, ...wordPieces]));
    expect(t.step).toBe(7);
    expect(guideClearPlan(t, [...mine, extra, ...wordPieces])).toEqual({ all: false, ids: ['k0', 'k1', 'k2', 'k3'] });
    // The c brought back by an undo during the word is still guide-built.
    expect(guideClearPlan(t, [...mine, ...cPieces, ...wordPieces])).toEqual({ all: false, ids: ['a', 'b', 'w', 'k0', 'k1', 'k2', 'k3'] });
  });

  it('after Keep, with their pieces deleted by the visitor, the clear is still scoped (it was their choice to keep)', () => {
    const s = recordBuilt(answerAsk(askGuide(), 'keep', C, world(mine), ['m1', 'm2']), ['a']);
    expect(guideClearPlan(s, [on('a', C[0]), pc('y', 'wedge', 0, 900)])).toEqual({ all: false, ids: ['a'] });
  });

  it('blank start, or Clear and start: the whole board as before', () => {
    const blank = recordBuilt(startGuide(C, world([])), ['a', 'b', 'w']);
    expect(guideClearPlan(blank, [...cPieces, pc('x', 'wedge', 900, 0)])).toEqual({ all: true });
    const cleared = recordBuilt(answerAsk(askGuide(), 'clear', C, world([]), ['m1', 'm2']), ['a', 'b', 'w']);
    expect(guideClearPlan(cleared, cPieces)).toEqual({ all: true });
    // ...but once their pieces are back (undoing Clear and start), never touch them.
    expect(guideClearPlan(cleared, [...mine, ...cPieces])).toEqual({ all: false, ids: ['a', 'b', 'w'] });
  });
});

describe('besideSpot: outlines in empty board beside their work (v1.2.1)', () => {
  const work: Rect = { x: 0, y: 0, w: 400, h: 200 };
  const size = { w: 200, h: 150 };
  const view = { w: 1400, h: 800 };
  const opts = { margin: 50, view, pad: 20, minZoom: 0.5 };

  it('the sides: right, below, left, above, each `margin` clear and centred on the work', () => {
    expect(BESIDE_ORDER).toEqual(['right', 'below', 'left', 'above']);
    expect(besideRect(work, size, 'right', 50)).toEqual({ x: 450, y: 25, w: 200, h: 150 });
    expect(besideRect(work, size, 'below', 50)).toEqual({ x: 100, y: 250, w: 200, h: 150 });
    expect(besideRect(work, size, 'left', 50)).toEqual({ x: -250, y: 25, w: 200, h: 150 });
    expect(besideRect(work, size, 'above', 50)).toEqual({ x: 100, y: -200, w: 200, h: 150 });
  });

  it('prefers right when the framing of both keeps the targets big enough', () => {
    const r = besideSpot(work, size, opts);
    expect(r.side).toBe('right');
    expect(rectsOverlap(r.rect, work)).toBe(false);
    expect(r.zoom).toBeGreaterThanOrEqual(opts.minZoom);
  });

  it('falls back to below (a tall, narrow phone view: right would make the targets too small)', () => {
    const r = besideSpot({ x: 0, y: 0, w: 400, h: 100 }, size, { ...opts, view: { w: 390, h: 800 }, minZoom: 0.55 });
    expect(r.side).toBe('below');
    expect(r.rect.y).toBeGreaterThanOrEqual(150);
  });

  it('falls back to left, then above, when something else is in the way on the preferred sides', () => {
    const blockR = { x: 420, y: -500, w: 5000, h: 1200 }; // everything to the right
    const blockB = { x: -500, y: 210, w: 1400, h: 5000 }; // everything below
    const left = besideSpot(work, size, { ...opts, avoid: [blockR, blockB], minZoom: 0.5 });
    expect(left.side).toBe('left');
    const blockL = { x: -5000, y: -500, w: 4980, h: 1200 };
    const above = besideSpot(work, size, { ...opts, avoid: [blockR, blockB, blockL], minZoom: 0.5 });
    expect(above.side).toBe('above');
    for (const r of [left, above]) for (const q of [work, blockR, blockB, blockL]) if (r !== left || q !== blockL) expect(rectsOverlap(r.rect, q)).toBe(false);
  });

  it('steps past an obstacle rather than overlapping it, and never overlaps the work, whatever the inputs', () => {
    const lone = { x: 460, y: 0, w: 60, h: 60 }; // one stray piece just right of the work
    const r = besideSpot(work, size, { ...opts, avoid: [lone] });
    expect(r.side).toBe('right');
    expect(rectsOverlap(r.rect, lone)).toBe(false);
    expect(r.rect.x).toBeGreaterThanOrEqual(lone.x + lone.w);
    let seed = 3;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 200; i++) {
      const w: Rect = { x: rnd() * 2000 - 1000, y: rnd() * 2000 - 1000, w: 10 + rnd() * 2000, h: 10 + rnd() * 2000 };
      const sz = { w: 50 + rnd() * 1500, h: 50 + rnd() * 600 };
      const v = { w: 300 + rnd() * 1200, h: 300 + rnd() * 600 };
      const out = besideSpot(w, sz, { margin: 40, view: v, pad: 10, minZoom: rnd() });
      expect(rectsOverlap(out.rect, w)).toBe(false);
      expect(BESIDE_ORDER).toContain(out.side);
    }
  });

  it('when no side keeps the targets big enough, the side framing largest wins (ties: the order)', () => {
    const r = besideSpot(work, size, { ...opts, minZoom: 99 });
    const zooms = BESIDE_ORDER.map((s) => fitZoom(((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }))(work, besideRect(work, size, s, 50)), view, 20));
    expect(r.zoom).toBeCloseTo(Math.max(...zooms), 9);
    expect(r.side).toBe(BESIDE_ORDER[zooms.indexOf(Math.max(...zooms))]);
  });
});

describe('frameBeside: both in view, or the outlines first (v1.2.1)', () => {
  const view: Rect = { x: 0, y: 100, w: 400, h: 700 }; // a phone: the docks cover the top 100
  const inView = (r: Rect, c: { x: number; y: number; zoom: number }, pad = 0) => {
    const a = { x: r.x * c.zoom + c.x, y: r.y * c.zoom + c.y }, b = { x: (r.x + r.w) * c.zoom + c.x, y: (r.y + r.h) * c.zoom + c.y };
    return a.x >= view.x + pad - 1e-6 && a.y >= view.y + pad - 1e-6 && b.x <= view.x + view.w - pad + 1e-6 && b.y <= view.y + view.h - pad + 1e-6;
  };

  it('frames both in full when the targets stay big enough', () => {
    const work = { x: 0, y: 0, w: 300, h: 200 }, out = { x: 0, y: 250, w: 300, h: 200 };
    const c = frameBeside(work, out, view, 10, 0.5, 5);
    expect(c.both).toBe(true);
    expect(inView(work, c, 10) && inView(out, c, 10)).toBe(true);
  });

  it('otherwise zooms to keep the targets big enough: the outlines fully in view at the far edge, their work partly in sight', () => {
    const work = { x: 0, y: 0, w: 2000, h: 300 }, out = { x: 2050, y: 50, w: 300, h: 200 };
    const c = frameBeside(work, out, view, 10, 1, 5);
    expect(c.both).toBe(false);
    expect(c.zoom).toBeCloseTo(1, 9);
    expect(inView(out, c, 10)).toBe(true);
    const workRight = (work.x + work.w) * c.zoom + c.x;
    expect(workRight, 'part of their work is still in view').toBeGreaterThan(view.x);
  });

  it('never zooms past maxZoom, nor past where the outlines alone fill the view', () => {
    const work = { x: 0, y: 0, w: 5000, h: 300 }, out = { x: 5050, y: 0, w: 300, h: 200 };
    expect(frameBeside(work, out, view, 10, 99, 1).zoom).toBe(1);
    expect(frameBeside(work, out, view, 10, 99, 99).zoom).toBeCloseTo(fitZoom(out, view, 10), 9);
    expect(frameBeside(null, out, view, 10, 0.1, 99).both).toBe(true);
  });
});

describe('the word in batches (v1.4.0, every layout)', () => {
  const at5 = () => observeGuide(startGuide(C, world([])), world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
  // WORD's batches: [0, 1] (the stem and the round: both ready, apart), [2] (the negative round, on the round), [3] (the
  // wedge, on the negative round).
  const ps = (...is: number[]) => is.map((i) => on(`p${i}`, WORD[i]));

  it('only the current batch shows and accepts pieces; it moves on when complete; progress counts the whole word', () => {
    let s = chooseWord(at5(), WORD, world([]));
    expect([s.step, currentBatch(s), activeOutlines(s), guideProgress(s)]).toEqual([6, 0, [0, 1], { done: 0, total: 4 }]);
    // A wedge dropped right on a later batch's (hidden) outline does not click in.
    expect(guideClickIn(s, world([pc('w', 'wedge', 701, 31, 40)]), ['w'])).toBeNull();
    s = observeGuide(s, world(ps(1)));
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done]).toEqual([0, [0], 1]);
    expect(nextOutline(s), 'Next: the lowest outline of the CURRENT batch').toBe(0);
    s = observeGuide(s, world(ps(1, 0)));
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done, s.stack]).toEqual([1, [2], 2, null]);
    s = observeGuide(s, world(ps(1, 0, 2)));
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done, s.stack]).toEqual([2, [3], 3, null]);
    expect(guideClickIn(s, world([...ps(1, 0, 2), pc('w', 'wedge', 701, 31, 40)]), ['w'])!.placements.map((p) => p.outline)).toEqual([3]);
    s = observeGuide(s, world(ps(1, 0, 2, 3)));
    expect([s.step, currentBatch(s), activeOutlines(s), s.stack]).toEqual([7, -1, [], null]);
  });

  it('safety net: a placed piece the visitor brings forward over one that belongs above it is prompted, and its batch is current again until fixed', () => {
    let s = observeGuide(chooseWord(at5(), WORD, world([])), world(ps(0, 1, 2)));
    expect([currentBatch(s), s.stack]).toEqual([2, null]);
    s = observeGuide(s, world(ps(0, 2, 1))); // the round brought forward over its negative round
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done]).toEqual([0, [], 1]);
    expect([s.stack?.id, s.stack?.dir], 'the most recently placed of the pair, one press').toEqual(['p2', 'forward']);
    expect(nextAction(s)?.kind, 'Next restacks it').toBe('stack');
    s = observeGuide(s, world(ps(0, 1, 2))); // sent back
    expect([currentBatch(s), activeOutlines(s), s.stack]).toEqual([2, [3], null]);
  });

  it('undo back across a batch boundary returns to the earlier batch (derived from the board); redo returns', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    let s = chooseWord(at5(), WORD, world([]));
    for (const i of [1, 0, 2, 3]) {
      h.record([...h.present, ...ps(i)]);
      s = observeGuide(s, world(h.present));
    }
    expect(s.step).toBe(7);
    s = observeGuide(s, world(h.undo()!)); // the wedge goes: its batch again
    expect([s.step, currentBatch(s), activeOutlines(s)]).toEqual([6, 2, [3]]);
    s = observeGuide(s, world(h.undo()!)); // the negative round goes
    expect([currentBatch(s), activeOutlines(s)]).toEqual([1, [2]]);
    s = observeGuide(s, world(h.undo()!)); // the stem goes: back into the first batch
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done]).toEqual([0, [0], 1]);
    s = observeGuide(s, world(h.redo()!));
    expect(currentBatch(s)).toBe(1);
    expect(s.batches, 'the plan itself never changes').toEqual([[0, 1], [2], [3]]);
  });

  it('the pieces already placed at Guide me are batch 0 (done); the plan follows on from them', () => {
    const s = chooseWord(at5(), WORD, world(ps(1)));
    expect(s.batches, 'the stem and the negative round: both ready once the round is in, and apart').toEqual([[1], [0, 2], [3]]);
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done]).toEqual([1, [0, 2], 1]);
  });
});

describe('freeRect: the largest free strip to frame a section in (v1.2.2)', () => {
  const area = { x: 0, y: 0, w: 400, h: 600 };
  it('no blockers: the whole area', () => {
    const f = freeRect({ w: 100, h: 100 }, area, [], 10);
    expect(f.rect).toEqual(area);
    expect(f.scale).toBeCloseTo(3.8);
  });
  it('a callout along the bottom: the strip above it', () => {
    const f = freeRect({ w: 100, h: 100 }, area, [{ x: 20, y: 450, w: 360, h: 120 }]);
    expect(f.rect).toEqual({ x: 0, y: 0, w: 400, h: 450 });
  });
  it('docks at the top corners: a tall content takes the column between them', () => {
    const f = freeRect({ w: 100, h: 590 }, area, [{ x: 0, y: 0, w: 150, h: 70 }, { x: 250, y: 0, w: 150, h: 70 }]);
    expect(f.rect).toEqual({ x: 150, y: 0, w: 100, h: 600 });
    expect(rectsOverlap(f.rect, { x: 0, y: 0, w: 150, h: 70 })).toBe(false);
  });
});

describe('step 0 on a blank board (v1.6.1)', () => {
  it('is its own phase, running, at step 0, distinct from the clean-fridge question', () => {
    const w = welcomeGuide();
    expect(w.phase).toBe('welcome');
    expect(w.step).toBe(0);
    expect(guideRunning(w)).toBe(true);
    expect(w).not.toEqual(askGuide());
    expect(w.outlines).toEqual([]);
  });
  it('answerAsk does nothing from it (only the clean-fridge question answers)', () => {
    const w = welcomeGuide();
    expect(answerAsk(w, 'clear', C, world([]), [])).toBe(w);
  });
});
