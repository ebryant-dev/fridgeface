import { describe, expect, it } from 'vitest';
import {
  BESIDE_ORDER, GUIDE_COPY, GUIDE_IDLE, GUIDE_LETTER, GUIDE_STORAGE_KEY, GUIDE_WORD, activeOutlines, answerAsk, askGuide, besideRect, besideSpot,
  chooseWord, currentSection, endGuide, fitZoom, freeRect, frameBeside, guideBuilt, guideClearPlan, guideClickIn, guideProgress, guideRunning, guideWanted, moveLetter,
  nextOutline, observeGuide, placeCallout, readGuideOff, recordBuilt, rectsOverlap, startGuide, withSections, writeGuideOff, type GuideState,
  type GuideStorage, type GuideWorld, type Rect,
} from './guide';
import type { Outline, OutlinePiece } from './outline';
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

describe('copy v2', () => {
  it('is the approved wording, word for word', () => {
    expect(GUIDE_COPY.step1).toBe('Drag the black oval onto the fridge.');
    expect(GUIDE_COPY.step2).toBe('Now drag the white oval onto the black one.');
    expect(GUIDE_COPY.step3a).toBe('Drag the wedge into place.');
    expect(GUIDE_COPY.step3b).toBe('Now turn it with the round handle to fit.');
    expect(GUIDE_COPY.step3bTouch).toBe('Now turn it with the round handle to fit, or twist with two fingers.');
    expect([GUIDE_COPY.step0, GUIDE_COPY.clearStart, GUIDE_COPY.keepMine]).toEqual(['Start on a clean fridge?', 'Clear and start', 'Keep my pieces']);
    expect([GUIDE_COPY.step4, GUIDE_COPY.step4Ask]).toEqual(["That's a c.", 'Want to spell "create" next?']);
    expect([GUIDE_COPY.guideMe, GUIDE_COPY.clearFree]).toEqual(['Guide me', 'Clear for free play']);
    expect(GUIDE_COPY.step5).toBe('Fill in the outlines to spell "create".');
    expect(GUIDE_COPY.progress(7, 18)).toBe('7 of 18');
    expect(GUIDE_COPY.step6).toBe('You made "create". Now try your own name.');
    expect([GUIDE_COPY.startFresh, GUIDE_COPY.keepIt, GUIDE_COPY.skip, GUIDE_COPY.dontShow, GUIDE_COPY.next, GUIDE_COPY.replay])
      .toEqual(['Start fresh', 'Keep it', 'Skip', "Don't show again", 'Next', 'Show guide']);
    expect(GUIDE_LETTER).toEqual({ char: 'c', variant: 1 });
    expect(GUIDE_WORD).toEqual({ text: 'create', variant: 1 });
  });
});

describe('step machine v2: the c (steps 1 to 4)', () => {
  it('starts at step 1 with ONE outline showing (the black oval), on a blank board', () => {
    const s = startGuide(C, world([]));
    expect(s.step).toBe(1);
    expect(s.phase).toBe('c');
    expect(activeOutlines(s)).toEqual([0]);
    expect(startGuide([], world([]))).toBe(GUIDE_IDLE); // no c: no guide
  });

  it('advances as each outline is filled, one outline at a time: 1 -> 2 -> 3 -> 4', () => {
    let s = startGuide(C, world([]));
    s = observeGuide(s, world([on('a', C[0])]));
    expect([s.step, activeOutlines(s)]).toEqual([2, [1]]);
    s = observeGuide(s, world([on('a', C[0]), on('b', C[1])]));
    expect([s.step, activeOutlines(s), s.turn]).toEqual([3, [2], null]);
    s = observeGuide(s, world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
    expect([s.step, activeOutlines(s)]).toEqual([4, []]);
    expect(observeGuide(s, world([on('a', C[0]), on('b', C[1]), on('w', C[2])]))).toBe(s); // unchanged: same object
  });

  it('a piece merely near, or of another shape, fills nothing', () => {
    const s = startGuide(C, world([]));
    expect(observeGuide(s, world([pc('a', 'positive-round', 5, 0)])).step).toBe(1); // near but not exactly on it
    expect(observeGuide(s, world([pc('a', 'negative-round', 0, 0)])).step).toBe(1); // exactly there, wrong shape
  });

  it('3a -> 3b: the wedge close to its outline but at the wrong angle; back to 3a when it is moved away', () => {
    const base = [on('a', C[0]), on('b', C[1])];
    let s = observeGuide(startGuide(C, world([])), world(base));
    expect([s.step, s.turn]).toEqual([3, null]);
    s = observeGuide(s, world([...base, pc('w', 'wedge', 120, 0, 0)])); // dropped near, unturned
    expect([s.step, s.turn]).toEqual([3, 'w']);
    expect(activeOutlines(s), 'the outline stays, at its angle').toEqual([2]);
    expect(observeGuide(s, world([...base, pc('w', 'wedge', 400, 0, 0)])).turn).toBe(null);
  });

  it('robust: a clicked-in piece moved away or deleted shows its outline again (the step goes back, never past a button)', () => {
    const all = [on('a', C[0]), on('b', C[1]), on('w', C[2])];
    let s = observeGuide(startGuide(C, world([])), world(all));
    expect(s.step).toBe(4);
    s = observeGuide(s, world([on('a', C[0]), { ...on('b', C[1]), x: 300 }, on('w', C[2])])); // the white oval moved off
    expect([s.step, activeOutlines(s)]).toEqual([2, [1]]);
    s = observeGuide(s, world([on('b', C[1]), on('w', C[2])])); // the black oval deleted
    expect([s.step, activeOutlines(s)]).toEqual([1, [0]]);
  });

  it('undo consistency: undoing a click-in (the board as it was) shows the outline again; redo fills it again', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    let s = startGuide(C, world([]));
    const dropped = [pc('a', 'positive-round', 6, -4)];
    h.record(dropped); // the drag
    const r = guideClickIn(s, world(dropped), ['a'])!;
    const snapped = dropped.map((p) => ({ ...p, ...r.placements[0] }));
    h.amend(snapped); // the click-in: the same undo step
    s = observeGuide(s, world(h.present));
    expect(s.step).toBe(2);
    s = observeGuide(s, world(h.undo()!)); // ONE undo: back to before the drag
    expect([s.step, h.present]).toEqual([1, []]);
    s = observeGuide(s, world(h.redo()!));
    expect(s.step).toBe(2);
  });
});

describe('click-in (guide only)', () => {
  it('a released piece of the right shape within tolerance clicks EXACTLY into the active outline', () => {
    const s = startGuide(C, world([]));
    const r = guideClickIn(s, world([pc('a', 'positive-round', 10, -12, 7)]), ['a']);
    expect(r?.placements).toEqual([{ id: 'a', x: 0, y: 0, rotation: 0, outline: 0 }]);
  });

  it('the wrong shape, too far, or the wrong angle stays where it was dropped', () => {
    const s = startGuide(C, world([]));
    expect(guideClickIn(s, world([pc('a', 'negative-round', 1, 1)]), ['a'])).toBeNull();
    expect(guideClickIn(s, world([pc('a', 'positive-round', 19, 0)]), ['a'])).toBeNull();
    expect(guideClickIn(s, world([pc('a', 'positive-round', 0, 0, 13)]), ['a'])).toBeNull();
  });

  it('only the ACTIVE outline accepts: the white oval does not click in during step 1', () => {
    const s = startGuide(C, world([]));
    expect(guideClickIn(s, world([pc('b', 'negative-round', 0, 0)]), ['b'])).toBeNull();
  });

  it('the wedge: within 12 degrees of 111.03 clicks in, wrapping included', () => {
    const base = [on('a', C[0]), on('b', C[1])];
    const s = observeGuide(startGuide(C, world([])), world(base));
    expect(s.step).toBe(3);
    const at = (r: number) => guideClickIn(s, world([...base, pc('w', 'wedge', 113, 2, r)]), ['w']);
    expect(at(100)?.placements[0].rotation).toBe(111.03);
    expect(at(122)).not.toBeNull();
    expect(at(98)).toBeNull();
    expect(at(-252)?.placements[0].rotation, '-252 is 108 the other way round').toBe(111.03);
  });

  it('NO snapping when the guide is inactive: idle, ended, or on a step without outlines', () => {
    const exact = world([on('a', C[0])]);
    expect(guideClickIn(GUIDE_IDLE, exact, ['a'])).toBeNull();
    expect(guideClickIn(endGuide(), world([pc('a', 'positive-round', 1, 1)]), ['a'])).toBeNull();
    const done = [on('a', C[0]), on('b', C[1]), on('w', C[2])];
    const s4 = observeGuide(startGuide(C, world([])), world(done));
    expect(s4.step).toBe(4);
    expect(guideClickIn(s4, world([...done, pc('x', 'positive-round', 2, 2)]), ['x'])).toBeNull();
  });
});

describe('step machine v2: the word (steps 5 and 6)', () => {
  const at4 = () => observeGuide(startGuide(C, world([])), world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));

  it('Guide me: from step 4 only; every outline of the word shows at once; any order; progress N of M; then step 6', () => {
    expect(chooseWord(startGuide(C, world([])), WORD, world([])).step, 'not from step 1').toBe(1);
    let s = chooseWord(at4(), WORD, world([]));
    expect([s.step, s.phase, activeOutlines(s), guideProgress(s)]).toEqual([5, 'word', [0, 1, 2, 3], { done: 0, total: 4 }]);
    s = observeGuide(s, world([on('w', WORD[3])])); // the last piece first
    expect([s.step, activeOutlines(s), guideProgress(s)]).toEqual([5, [0, 1, 2], { done: 1, total: 4 }]);
    s = observeGuide(s, world([on('w', WORD[3]), on('n', WORD[2]), on('s', WORD[0])]));
    expect(guideProgress(s)).toEqual({ done: 3, total: 4 });
    s = observeGuide(s, world([on('w', WORD[3]), on('n', WORD[2]), on('s', WORD[0]), on('r', WORD[1])]));
    expect([s.step, activeOutlines(s), guideProgress(s)]).toEqual([6, [], { done: 4, total: 4 }]);
  });

  it('never goes back past Guide me: an emptied board (or an undo bringing the c back) stays on the word', () => {
    let s = chooseWord(at4(), WORD, world([]));
    s = observeGuide(s, world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
    expect([s.step, s.phase]).toEqual([5, 'word']);
    s = observeGuide(s, world(WORD.map((o, i) => on(`p${i}`, o))));
    expect(s.step).toBe(6);
    s = observeGuide(s, world(WORD.slice(1).map((o, i) => on(`p${i + 1}`, o)))); // a piece deleted at step 6
    expect([s.step, activeOutlines(s)]).toEqual([5, [0]]);
  });

  it('the turning hint in step 5: a piece close to its outline but mis-angled', () => {
    const s = observeGuide(chooseWord(at4(), WORD, world([])), world([pc('x', 'wedge', 705, 30, 0)]));
    expect([s.step, s.turn]).toEqual([5, 'x']);
  });

  it('stacking order: a negative filled BEFORE its positive still ends up above it, in the same click-in', () => {
    let s = chooseWord(at4(), WORD, world([]));
    const neg = on('n', WORD[2]);
    s = observeGuide(s, world([neg]));
    const board = [neg, pc('r', 'positive-round', 604, 3)]; // the round, added later, is on top
    const r = guideClickIn(s, world(board), ['r'])!;
    expect(r.placements.map((p) => p.id)).toEqual(['r']);
    expect(r.order, 'the round goes under the negative round, as in the word').toEqual(['r', 'n']);
  });

  it('two pieces released together each click into their own outline', () => {
    const s = chooseWord(at4(), WORD, world([]));
    const r = guideClickIn(s, world([pc('s', 'positive-stem', 502, 1, -3), pc('w', 'wedge', 698, 31, 45)]), ['s', 'w'])!;
    expect(r.placements.map((p) => [p.id, p.outline])).toEqual([['s', 0], ['w', 3]]);
  });

  it('Next fills the lowest active outline; none on steps 4 and 6', () => {
    expect(nextOutline(startGuide(C, world([])))).toBe(0);
    expect(nextOutline(at4())).toBeNull();
    const s = observeGuide(chooseWord(at4(), WORD, world([])), world([on('s', WORD[0])]));
    expect(nextOutline(s)).toBe(1);
  });

  it('without the word, step 4 cannot choose it', () => {
    const s4: GuideState = at4();
    expect(chooseWord(s4, [], world([]))).toBe(s4);
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
    expect([s.step, s.phase, s.kept, s.theirs, s.built, activeOutlines(s)]).toEqual([1, 'c', false, ['m1', 'm2'], [], [0]]);
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
    expect(s.step).toBe(4);
    const extra = pc('x', 'negative-stem', 2000, 0); // added by the visitor during the guide, not clicked in: theirs
    expect(guideClearPlan(s, [...mine, ...cPieces, extra])).toEqual({ all: false, ids: ['a', 'b', 'w'] });
    // Guide me, then the word filled: Start fresh removes the word's pieces only.
    let t = chooseWord(s, WORD, world([...mine, extra]));
    const wordPieces = WORD.map((o, i) => on(`k${i}`, o));
    t = observeGuide(recordBuilt(t, wordPieces.map((p) => p.id)), world([...mine, extra, ...wordPieces]));
    expect(t.step).toBe(6);
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

describe('phones: the word one section at a time (v1.2.2)', () => {
  const at4 = () => observeGuide(startGuide(C, world([])), world([on('a', C[0]), on('b', C[1]), on('w', C[2])]));
  // Two sections: the stem and the round with its negative round (indices 0 to 2), then the wedge (index 3).
  const SECTIONS = [[0, 2, 1], [3]];
  const ps = (...is: number[]) => is.map((i) => on(`p${i}`, WORD[i]));

  it('only the current section shows and accepts pieces; it moves on when complete; progress counts the whole word', () => {
    let s = chooseWord(at4(), WORD, world([]), SECTIONS);
    expect([s.step, currentSection(s), activeOutlines(s), guideProgress(s)]).toEqual([5, 0, [0, 1, 2], { done: 0, total: 4 }]);
    // A wedge dropped right on the (hidden) next section's outline does not click in.
    expect(guideClickIn(s, world([pc('w', 'wedge', 701, 31, 40)]), ['w'])).toBeNull();
    s = observeGuide(s, world(ps(2)));
    expect([currentSection(s), activeOutlines(s), guideProgress(s).done]).toEqual([0, [0, 1], 1]);
    expect(nextOutline(s), 'Next: the lowest outline of the CURRENT section').toBe(0);
    s = observeGuide(s, world(ps(2, 0, 1)));
    expect([s.step, currentSection(s), activeOutlines(s), guideProgress(s).done]).toEqual([5, 1, [3], 3]);
    expect(nextOutline(s)).toBe(3);
    expect(guideClickIn(s, world([...ps(2, 0, 1), pc('w', 'wedge', 701, 31, 40)]), ['w'])!.placements.map((p) => p.outline)).toEqual([3]);
    s = observeGuide(s, world(ps(0, 1, 2, 3)));
    expect([s.step, currentSection(s), activeOutlines(s)]).toEqual([6, -1, []]);
  });

  it('undo back across a section boundary returns to the earlier section (derived from the board)', () => {
    const h = new History<readonly OutlinePiece[]>([]);
    let s = chooseWord(at4(), WORD, world([]), SECTIONS);
    for (const i of [0, 1, 2, 3]) {
      h.record([...h.present, ...ps(i)]);
      s = observeGuide(s, world(h.present));
    }
    expect(s.step).toBe(6);
    s = observeGuide(s, world(h.undo()!)); // the wedge goes: section 2 again
    expect([s.step, currentSection(s), activeOutlines(s)]).toEqual([5, 1, [3]]);
    s = observeGuide(s, world(h.undo()!)); // the negative round goes: back into section 1
    expect([currentSection(s), activeOutlines(s)]).toEqual([0, [2]]);
    s = observeGuide(s, world(h.redo()!));
    expect(currentSection(s)).toBe(1);
  });

  it('switching layouts mid-step keeps progress: sections on and off, filled outlines stay filled', () => {
    let s = observeGuide(chooseWord(at4(), WORD, world([]), SECTIONS), world(ps(3)));
    expect([activeOutlines(s), guideProgress(s).done]).toEqual([[0, 1, 2], 1]); // the wedge, filled early, still counts
    const desk = withSections(s, null, world(ps(3)));
    expect([desk.sections, desk.step, activeOutlines(desk), guideProgress(desk).done]).toEqual([null, 5, [0, 1, 2], 1]);
    s = withSections(desk, SECTIONS, world(ps(3)));
    expect([currentSection(s), activeOutlines(s)]).toEqual([0, [0, 1, 2]]);
    expect(withSections(at4(), SECTIONS, world([])).sections, 'only in the word phase').toBeNull();
  });

  it('sections that do not cover every outline exactly once fall back to the whole word', () => {
    for (const bad of [[[0, 1], [3]], [[0, 1, 2], [2, 3]], [[0, 1, 2, 3], []], [[0, 1, 2, 9], [3]]]) {
      const s = chooseWord(at4(), WORD, world([]), bad);
      expect([s.sections, activeOutlines(s)]).toEqual([null, [0, 1, 2, 3]]);
    }
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
