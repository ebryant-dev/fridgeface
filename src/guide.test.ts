import { describe, expect, it } from 'vitest';
import {
  GUIDE_COPY, GUIDE_IDLE, GUIDE_STORAGE_KEY, cutPairs, endGuide, guideWanted, nextStep, observeGuide, placeCallout, readGuideOff,
  rebaseGuide, rectsOverlap, startGuide, stepDone, writeGuideOff, type GuideState, type GuideStorage, type GuideWorld, type Rect,
} from './guide';
import type { PlacedPiece } from './selection';

// Two synthetic shapes: a 20 x 20 square, positive ("pos") and negative ("neg"). Real outlines are covered in selection.test.ts.
const SQ = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
const world = (pieces: PlacedPiece[]): GuideWorld => ({
  pieces,
  polarityOf: (s) => (s === 'pos' ? 'positive' : s === 'neg' ? 'negative' : undefined),
  hullOf: () => SQ,
});
const pc = (id: string, shapeId: 'pos' | 'neg', x = 0, y = 0, rotation = 0): PlacedPiece => ({ id, shapeId, x, y, rotation });

/** An "intro": a positive with a negative on top of it (one cut pair), and a lone positive far away. */
const INTRO = [pc('a', 'pos'), pc('b', 'neg', 5, 0), pc('c', 'pos', 200, 0)];

describe('copy', () => {
  it('is the approved wording', () => {
    expect(GUIDE_COPY.step1).toBe('Drag a shape from the tray onto the board.');
    expect(GUIDE_COPY.step2).toBe('Drag the round handle to turn it.');
    expect(GUIDE_COPY.step2Touch).toBe('Drag the round handle to turn it, or twist with two fingers.');
    expect(GUIDE_COPY.step3).toBe('White shapes cut into black. Drop one on top of a black shape.');
    expect(GUIDE_COPY.step4).toBe('Now try making your name.');
    expect(GUIDE_COPY.noteLetters.join('') + ' ' + GUIDE_COPY.noteFree).toBe("Need ideas? Open Letters (abc). There's no wrong way.");
    expect([GUIDE_COPY.startFresh, GUIDE_COPY.keepPlaying, GUIDE_COPY.skip, GUIDE_COPY.dontShow, GUIDE_COPY.replay]).toEqual(['Start fresh', 'Keep playing', 'Skip', "Don't show again", 'Show guide']);
  });
});

describe('transitions', () => {
  it('starts at step 1; Next walks 1 -> 2 -> 3 -> 4 -> ended', () => {
    const w = world(INTRO);
    let s = startGuide(w);
    expect(s.step).toBe(1);
    for (const n of [2, 3, 4]) {
      s = nextStep(s, w);
      expect(s.step).toBe(n);
    }
    expect(nextStep(s, w)).toBe(GUIDE_IDLE);
    expect(nextStep(GUIDE_IDLE, w)).toBe(GUIDE_IDLE);
  });

  it('step 1 completes when the piece count rises, by any add method', () => {
    const s = startGuide(world(INTRO));
    expect(observeGuide(s, world(INTRO))).toBe(s); // nothing happened
    const after = observeGuide(s, world([...INTRO, pc('d', 'pos', 400)]));
    expect(after.step).toBe(2);
    expect(observeGuide(s, world([...INTRO, pc('d', 'neg'), pc('e', 'neg')])).step).toBe(2); // a suggestion adds several
  });

  it('step 1: clearing then adding one piece counts (the count rose from its lowest point)', () => {
    let s = startGuide(world(INTRO));
    s = observeGuide(s, world([]));
    expect(s.step).toBe(1);
    expect(s.base.minCount).toBe(0);
    expect(observeGuide(s, world([pc('z', 'pos')])).step).toBe(2);
  });

  it('step 2 completes when any piece rotation changes, including a piece added during the step', () => {
    const w = world(INTRO);
    const s = nextStep(startGuide(w), w);
    expect(s.step).toBe(2);
    expect(stepDone(s, world(INTRO.map((p) => ({ ...p, x: p.x + 50 }))))).toBe(false); // moving is not turning
    expect(observeGuide(s, world([INTRO[0], { ...INTRO[1], rotation: 1 }, INTRO[2]])).step).toBe(3);
    // A piece added during the step: its first rotation is its baseline; turning it completes the step.
    const s2 = observeGuide(s, world([...INTRO, pc('n', 'neg', 0, 0, 30)]));
    expect(s2.step).toBe(2);
    expect(observeGuide(s2, world([...INTRO, pc('n', 'neg', 0, 0, 30)]))).toBe(s2);
    expect(observeGuide(s2, world([...INTRO, pc('n', 'neg', 0, 0, 31)])).step).toBe(3);
  });

  it('step 4 never completes by itself; ending from any step returns to idle', () => {
    const w = world(INTRO);
    const s4: GuideState = nextStep(nextStep(nextStep(startGuide(w), w), w), w);
    expect(s4.step).toBe(4);
    expect(observeGuide(s4, world([]))).toBe(s4);
    expect(observeGuide(s4, world([...INTRO, pc('x', 'neg', 200)]))).toBe(s4);
    expect(endGuide()).toBe(GUIDE_IDLE);
    expect(observeGuide(GUIDE_IDLE, world([pc('q', 'pos')]))).toBe(GUIDE_IDLE);
  });

  it('a load or undo re-baselines the current step (it does not count as doing it)', () => {
    let s = startGuide(world([]));
    s = rebaseGuide(s, world(INTRO)); // a share link loads three pieces
    expect(s.step).toBe(1);
    expect(observeGuide(s, world(INTRO))).toBe(s);
    expect(rebaseGuide(GUIDE_IDLE, world(INTRO))).toBe(GUIDE_IDLE);
  });
});

describe('step 3: a NEW negative-over-positive pair', () => {
  const step3 = (pieces: PlacedPiece[]) => {
    const w = world(pieces);
    return nextStep(nextStep(startGuide(w), w), w);
  };

  it('finds pairs only where the negative overlaps the positive AND sits above it', () => {
    expect(cutPairs(world(INTRO))).toEqual(['b>a']);
    expect(cutPairs(world([pc('n', 'neg'), pc('p', 'pos', 5)]))).toEqual([]); // negative below: no cut
    expect(cutPairs(world([pc('p', 'pos'), pc('n', 'neg', 20.5)]))).toEqual([]); // just apart
    expect(cutPairs(world([pc('p', 'pos'), pc('n', 'neg', 20)]))).toEqual([]); // touching edges is not overlapping
    expect(cutPairs(world([pc('p', 'pos'), pc('q', 'pos', 5)]))).toEqual([]); // two positives
  });

  it("the intro's existing pairs do not complete it", () => {
    const s = step3(INTRO);
    expect(s.step).toBe(3);
    expect(s.base.pairs).toEqual(['b>a']);
    expect(stepDone(s, world(INTRO))).toBe(false);
    expect(observeGuide(s, world(INTRO))).toBe(s);
    // Other changes that make no new pair: moving the cut a little (still the same pair), adding a positive far away.
    expect(observeGuide(s, world([INTRO[0], { ...INTRO[1], x: 7 }, INTRO[2]]))).toBe(s);
    expect(observeGuide(s, world([...INTRO, pc('d', 'pos', 900)])).step).toBe(3);
  });

  it('a negative dropped on a positive completes it', () => {
    const s = step3(INTRO);
    expect(observeGuide(s, world([...INTRO, pc('n', 'neg', 205)])).step).toBe(4); // new negative on top of c
    expect(observeGuide(s, world([INTRO[0], { ...INTRO[1], x: 195 }, INTRO[2]])).step).toBe(3); // b moved under c: c is above it, no cut
    expect(observeGuide(s, world([INTRO[0], INTRO[2], { ...INTRO[1], x: 195 }])).step).toBe(4); // ...and on top of c: a new cut
  });

  it('putting a positive on top of a negative does not count; restacking the negative above it does', () => {
    const s = step3(INTRO);
    const under = [...INTRO, pc('n', 'neg', 400), pc('p', 'pos', 405)];
    const s2 = observeGuide(s, world(under));
    expect(s2.step).toBe(3);
    expect(observeGuide(s2, world([...INTRO, pc('p', 'pos', 405), pc('n', 'neg', 400)])).step).toBe(4);
  });

  it('an old pair that is broken and then made again counts', () => {
    let s = step3(INTRO);
    s = observeGuide(s, world([INTRO[0], { ...INTRO[1], x: 100 }, INTRO[2]])); // b moved off a
    expect(s.step).toBe(3);
    expect(s.base.pairs).toEqual([]);
    expect(observeGuide(s, world(INTRO)).step).toBe(4);
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

  it('"Don\'t show again" stores fridgeface:guide:v1 = off, and reads back', () => {
    const s = store();
    expect(GUIDE_STORAGE_KEY).toBe('fridgeface:guide:v1');
    expect(readGuideOff(() => s)).toBe(false);
    expect(writeGuideOff(() => s)).toBe(true);
    expect(s.m.get('fridgeface:guide:v1')).toBe('off');
    expect(readGuideOff(() => s)).toBe(true);
    expect(readGuideOff(() => store({ 'fridgeface:guide:v1': 'on' }))).toBe(false);
  });

  it('replaying does not unset it', () => {
    const s = store({ 'fridgeface:guide:v1': 'off' });
    const off = readGuideOff(() => s);
    expect(guideWanted({ disabled: false, authoring: false, off }, true)).toBe(true);
    expect(startGuide(world(INTRO)).step).toBe(1);
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
    const s = startGuide(world(INTRO));
    expect(endGuide().step).toBe(0);
    expect(s.step).toBe(1);
    const st = store();
    expect(guideWanted({ disabled: false, authoring: false, off: readGuideOff(() => st) })).toBe(true); // nothing stored by Skip
  });
});

describe('placeCallout', () => {
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
