import { describe, expect, it, vi } from 'vitest';
import { BATCH_MAX, batchOf, dependencies, downwardClosed, localitySpan, planBatches, readyOutlines, validatePlan } from './batches';
import { CURATED, contentKey, curatedPlan, resetCuratedWarning } from './guide-plans';
import { HULLS } from './hulls.testdata';
import { boundsOf, bringForwardOverlapping, convexIntersect, placeOutline, sendBackwardOverlapping } from './selection';
import { stackCheck, stackPrompt } from './stacking';
import { activeOutlines, chooseWord, currentBatch, guideProgress, observeGuide, startGuide, type GuideWorld } from './guide';
import { History } from './history';
import type { Outline, OutlinePiece } from './outline';

/**
 * v1.4.0: the guided word is built in STACKING ORDER, one small batch at a time (src/batches.ts). These tests use Edward's
 * REAL word-create-1 (read only; nothing in src/suggestions/ is touched) with the shapes' real convex outlines
 * (src/hulls.testdata.ts, as src/shapes.ts computes them in a browser; the browser suite checks the live plan equals the
 * snapshot below).
 */
const files = import.meta.glob('./suggestions/word-create-1.json', { eager: true, import: 'default' }) as Record<string, { pieces: { s: string; x: number; y: number; r: number }[] }>;
const CREATE: Outline[] = Object.values(files)[0].pieces.map((p) => ({ shapeId: p.s, x: p.x, y: p.y, rotation: p.r }));
const N = CREATE.length;
const poly = (o: Outline) => placeOutline(HULLS[o.shapeId], o);
const overlaps = (a: Outline, b: Outline) => convexIntersect(poly(a), poly(b));
/** The component's measures: real outline bounds, a span of two average letters of the word (`localitySpan`: about 789; v1.4.0/1 had 1.6 positive stems, 702). */
const STEM = 438.9067888515738;
const boxOf = (o: Outline) => boundsOf(poly(o));
const LETTERS = 6; // "create"
const SPAN = localitySpan(CREATE.map(boxOf), LETTERS, 2);
const OPT = { boxOf, span: SPAN };
/** The c inside the word (findWordC): its three bottom pieces, built and stacked before Guide me. */
const C = [0, 1, 2];

/** The real word's overlap matrix (by outline index). */
const OV: boolean[][] = CREATE.map((a) => CREATE.map((b) => a !== b && overlaps(a, b)));
const PAIRS: [number, number][] = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (OV[i][j]) PAIRS.push([i, j]);

/** The real word's plan from the built c, as the component makes it at Guide me. */
const AUTO = planBatches(CREATE, overlaps, C, OPT);
/** The plan in effect for the real word: the one curated for it (guide-plans.ts), which guide.ts uses at Guide me. */
const PLAN = curatedPlan(CREATE, overlaps, C) ?? [];

/** A fixed-seed shuffle (the same LCG as the stacking simulation). */
function shuffler(seed: number) {
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  return <T>(a: readonly T[]) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
}

/**
 * The correctness simulation: from `start` (already on the board, in the word's order), place every other outline batch by
 * batch, in the given within-batch order, each new piece landing on TOP (as from the tray, or Next). After every placement
 * the guide's own check runs (stackCheck, and stackPrompt with the real overlap test); a prompt is answered at once with the
 * prompted presses, as the visitor would. Returns how many prompts showed, how many were tangles (no exact presses), and
 * the final board order (piece `p<i>` sits on outline i).
 */
function simulate(batches: readonly (readonly number[])[], start: readonly number[], order: (b: readonly number[]) => readonly number[]) {
  const pieces = CREATE.map((o, i): OutlinePiece => ({ id: `p${i}`, ...o }));
  const ov = (a: OutlinePiece, b: OutlinePiece) => OV[Number(a.id.slice(1))][Number(b.id.slice(1))];
  let board = start.map((i) => `p${i}`);
  const recent = [...board];
  let prompts = 0, tangles = 0;
  for (const b of batches) {
    for (const i of order(b.filter((k) => !start.includes(k)))) {
      board = [...board, `p${i}`];
      recent.push(`p${i}`);
      for (let guard = 0; guard < 100; guard++) {
        const filled = CREATE.map((_, k) => (board.includes(`p${k}`) ? `p${k}` : null));
        const ps = board.map((id) => pieces[Number(id.slice(1))]);
        if (stackCheck(filled, ps, ov).wrong.length === 0) break;
        const pr = stackPrompt(filled, ps, ov, recent)!;
        prompts++;
        if (!pr.presses) tangles++;
        board = pr.order;
      }
    }
  }
  return { prompts, tangles, board };
}

const rightOrder = (board: readonly string[]) => PAIRS.every(([a, b]) => board.indexOf(`p${a}`) < board.indexOf(`p${b}`));

describe('dependencies: the word\'s stacking order wherever pieces actually overlap', () => {
  it('a piece depends on every LOWER piece it overlaps, and on nothing else', () => {
    const sq = (x: number, y = 0): Outline => ({ shapeId: 'negative-round', x, y, rotation: 0 });
    // 0 and 1 overlap; 2 overlaps 1 only; 3 overlaps none of them; 4 overlaps 3 only.
    const word = [sq(0), sq(100), sq(220), sq(1000), sq(1080)];
    expect(dependencies(word, overlaps)).toEqual([[], [0], [1], [], [3]]);
    expect(readyOutlines(dependencies(word, overlaps), new Set())).toEqual([0, 3]);
    expect(readyOutlines(dependencies(word, overlaps), new Set([0, 3]))).toEqual([1, 4]);
    expect(downwardClosed(dependencies(word, overlaps), new Set([0, 1]))).toBe(true);
    expect(downwardClosed(dependencies(word, overlaps), new Set([1])), 'piece 1 is placed but 0, below it, is not').toBe(false);
  });

  it('the REAL word: its overlapping pairs give this dependency order (the c, its three bottom pieces, is closed downward)', () => {
    const deps = dependencies(CREATE, overlaps);
    expect(deps).toEqual([
      [], [0], [0, 1], [2], [0, 2, 3], [2, 3], [2, 3, 5], [2, 4, 6], [3, 6], [6, 8], [3, 6, 8, 9], [8, 9], [10, 11], [10, 11, 12],
      [10, 11, 12, 13], [11, 12, 13, 14], [], [16], [], [18], [18, 19], [18, 20], [17], [18, 19, 20, 21], [11, 15], [], [25], [25],
      [26], [27, 28], [25, 26, 27, 28, 29], [28, 29],
    ]);
    expect(PAIRS.length).toBe(deps.flat().length);
    expect(downwardClosed(deps, new Set(C))).toBe(true);
  });
});

describe('planBatches: ready, non-overlapping, nearby, at most four', () => {
  it('the locality window is two average letters: the word\'s width over its 6 letters, twice (about 789, 1.8 stems)', () => {
    const all = boundsOf(CREATE.flatMap((o) => poly(o)));
    expect(SPAN).toBeCloseTo((all.w / 6) * 2, 6);
    expect(SPAN).toBeGreaterThan(1.6 * STEM); // wider than the v1.4.0 window
    expect(Math.round(SPAN)).toBe(789);
  });

  it('the AUTOMATIC plan of the real word from the built c: batch 0 is the c, then 16 batches of 1 to 3 (v1.4.1: 18)', () => {
    expect(AUTO).toEqual([
      [0, 1, 2], [3], [4, 5], [6], [7, 8], [9, 16], [10, 11], [12, 17, 18], [13, 19], [14], [15, 20, 22], [24], [21, 25],
      [23, 26], [27, 28], [29], [30, 31],
    ]);
  });

  it('maximal (the automatic planner): a batch that closes short of four has NO other ready outline in the window that overlaps nothing in it', () => {
    const deps = dependencies(CREATE, overlaps);
    const placed = new Set<number>(C);
    AUTO.forEach((batch, k) => {
      if (k === 0) return;
      if (batch.length < BATCH_MAX) {
        const box = boundsOf(batch.flatMap((i) => poly(CREATE[i])));
        for (let j = 0; j < N; j++) {
          if (placed.has(j) || batch.includes(j) || !deps[j].every((d) => placed.has(d))) continue; // not unplaced-and-ready
          if (batch.some((i) => OV[i][j])) continue; // it overlaps something in the batch
          const u = boundsOf([...batch, j].flatMap((i) => poly(CREATE[i])));
          expect(Math.max(u.w, u.h), `batch ${k} ${JSON.stringify(batch)}: ready outline ${j} would fit the window (union ${Math.round(u.w)} x ${Math.round(u.h)}, was ${Math.round(box.w)} x ${Math.round(box.h)})`).toBeGreaterThan(SPAN);
        }
      }
      for (const i of batch) placed.add(i);
    });
  });

  for (const [name, start] of [['from the built c', C], ['from nothing (the fallback: the word placed fresh, 0 of 32)', []]] as const) {
    it(`every batch obeys the rules, ${name}`, () => {
      const plan = planBatches(CREATE, overlaps, start, OPT);
      const deps = dependencies(CREATE, overlaps);
      expect(plan.flat().sort((a, b) => a - b), 'every outline exactly once').toEqual(CREATE.map((_, i) => i));
      const placed = new Set<number>(start);
      plan.forEach((b, k) => {
        expect(b.length, `batch ${k} is not empty`).toBeGreaterThan(0);
        if (k === 0 && start.length) {
          expect(b).toEqual([...start]);
          return;
        }
        expect(b.length, `batch ${k}: at most ${BATCH_MAX}`).toBeLessThanOrEqual(BATCH_MAX);
        for (const i of b) expect(deps[i].every((j) => placed.has(j)), `batch ${k}: outline ${i} is ready`).toBe(true);
        for (const i of b) for (const j of b) if (i < j) expect(OV[i][j], `batch ${k}: ${i} and ${j} do not overlap`).toBe(false);
        if (b.length > 1) {
          const box = boundsOf(b.flatMap((i) => poly(CREATE[i])));
          expect(Math.max(box.w, box.h), `batch ${k} is compact`).toBeLessThanOrEqual(SPAN + 1e-6);
        }
        for (const i of b) placed.add(i);
      });
      expect(batchOf(plan, N).every((k) => k >= 0)).toBe(true);
    });
  }

  it('roughly left to right: each batch starts near the last one, and the word is swept without going far back', () => {
    const cx = AUTO.map((b) => b.reduce((s, i) => s + CREATE[i].x, 0) / b.length);
    const back = cx.slice(1).filter((x, k) => x < cx[k] - STEM / 2).length;
    expect(back, `centres: ${cx.map(Math.round).join(' ')}`).toBeLessThanOrEqual(2);
    expect(cx.at(-1)! - cx[0], 'it ends at the far right (the flower)').toBeGreaterThan(1500);
  });

  it('batches are fixed: the plan is a pure function of the word and what was placed (not of the order pieces go in)', () => {
    expect(planBatches(CREATE, overlaps, [2, 0, 1], OPT)).toEqual(AUTO);
    expect(planBatches(CREATE, overlaps, C, OPT)).toEqual(AUTO);
  });
});

describe('the curated plan for "create" (guide-plans.ts)', () => {
  const FIXED = [
    [0, 1, 2], [3], [4, 5], [6], [7, 8], [9], [10, 11, 16], [12, 17, 18], [13, 19], [14], [15, 20, 22], [24], [21, 25], [23, 26],
    [27, 28], [29], [30, 31],
  ];

  it('is in effect for the real word, and passes the same rules as the automatic plan', () => {
    expect(PLAN).toEqual(FIXED);
    expect(validatePlan(CREATE, overlaps, C, PLAN)).toBeNull();
    expect(PLAN.length - 1, '16 batches after the c, as many as the automatic plan').toBe(16);
    expect(CURATED.map((q) => q.key)).toContain(contentKey(CREATE));
  });

  /**
   * Edward's report on v1.4.1: "The stem of the t came up alone, followed by the black stem and wedge of the first e. Those
   * three shapes could have come up together since none of them overlap each other." In word-create-1 (by position and shape):
   *   16  positive-stem, upright, x 1062: the STEM OF THE t (17, the long positive stem lying across it, is the crossbar)
   *   10  positive-stem, lying across, x 705: the BLACK STEM of the FIRST e (the third letter; 8 is its black oval, 9 its white oval)
   *   11  wedge, x 800, below it: the WEDGE of the first e
   * They overlap nothing among themselves, but 10 and 11 sit on the e's white oval (9), so 9 comes in an EARLIER batch. The
   * automatic plan puts 16 in 9's batch ([9, 16], then [10, 11]); Edward chose [9] alone, then [10, 11, 16], so the real word
   * has a curated plan.
   */
  it('Edward\'s example: the curated plan is in effect and has the e\'s white oval 9 alone, then the t stem 16 with the e\'s black stem 10 and wedge 11', () => {
    expect([CREATE[16].shapeId, CREATE[10].shapeId, CREATE[11].shapeId]).toEqual(['positive-stem', 'positive-stem', 'wedge']);
    expect([OV[16][10], OV[16][11], OV[10][11]], 'none of the three overlaps another').toEqual([false, false, false]);
    const k = PLAN.findIndex((b) => b.includes(9));
    expect(PLAN[k]).toEqual([9]);
    expect([...PLAN[k + 1]].sort((a, b) => a - b)).toEqual([10, 11, 16]);
    // In effect through the guide itself (guide.ts), not only the lookup.
    const s = chooseWord(observeGuide(startGuide(C.map((i) => CREATE[i]), { pieces: [], sizeOf: () => STEM, overlaps }), { pieces: C.map((i) => ({ id: `p${i}`, ...CREATE[i] })), sizeOf: () => STEM, overlaps }), CREATE, { pieces: C.map((i) => ({ id: `p${i}`, ...CREATE[i] })), sizeOf: () => STEM, overlaps }, OPT);
    expect(s.batches).toEqual(PLAN);
  });

  it('the content key does not depend on where the word sits (the word is placed at the c) but on what it is', () => {
    const moved = CREATE.map((o) => ({ ...o, x: o.x + 1234.5678, y: o.y - 321.987 }));
    expect(contentKey(moved)).toBe(contentKey(CREATE));
    expect(curatedPlan(moved, overlaps, C)).toEqual(PLAN);
  });

  it('a modified word falls back to the automatic planner (no curated plan applies)', () => {
    const edited = CREATE.map((o, i) => (i === 16 ? { ...o, x: o.x + 40 } : o));
    expect(contentKey(edited)).not.toBe(contentKey(CREATE));
    expect(curatedPlan(edited, overlaps, C)).toBeNull();
    expect(curatedPlan(CREATE.slice(0, 31), overlaps, C)).toBeNull();
    const w: GuideWorld = { pieces: C.map((i) => ({ id: `p${i}`, ...CREATE[i] })), sizeOf: () => STEM, overlaps };
    const s = chooseWord(observeGuide(startGuide(C.map((i) => CREATE[i]), { pieces: [], sizeOf: () => STEM, overlaps }), w), edited, w, OPT);
    expect(s.batches).toEqual(planBatches(edited, overlaps, C, OPT));
    // From a different start (not its c) the curated plan does not apply either.
    expect(curatedPlan(CREATE, overlaps, [])).toBeNull();
  });

  it('validation: the rules the proof needs; a curated plan that breaks one is not used (one console.warn)', () => {
    expect(validatePlan(CREATE, overlaps, C, [...PLAN.slice(0, 1), [3], [3], ...PLAN.slice(2)])).toMatch(/twice/);
    expect(validatePlan(CREATE, overlaps, C, PLAN.slice(0, -1))).toMatch(/not every/);
    expect(validatePlan(CREATE, overlaps, C, [[0, 1, 2], [4, 5], [3], ...PLAN.slice(3)])).toMatch(/not ready/);
    expect(validatePlan(CREATE, overlaps, C, [[0, 1, 2], [3, 4], [5], ...PLAN.slice(3)])).toMatch(/not ready|overlap/);
    expect(validatePlan(CREATE, overlaps, C, [[0, 1, 2], [3], [4, 5], [6], [7, 8], [9], [10, 11, 16, 12, 17], ...PLAN.slice(7)])).toMatch(/more than 4|twice|overlap|not ready/);
    expect(validatePlan(CREATE, overlaps, [0, 1], PLAN)).toMatch(/batch 0/);
    expect(validatePlan(CREATE, overlaps, C, [...PLAN.slice(0, 1), [], ...PLAN.slice(1)])).toMatch(/empty/);
    // A bad curated entry for a made-up word (two overlapping outlines in one batch).
    const sq = (x: number): Outline => ({ shapeId: 'negative-round', x, y: 0, rotation: 0 });
    const word = [sq(0), sq(100), sq(1000)];
    (CURATED as unknown as unknown[]).push({ key: contentKey(word), plan: [[0], [1, 2], [0]], note: 'test' } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      resetCuratedWarning();
      expect(curatedPlan(word, overlaps, [0])).toBeNull();
      expect(curatedPlan(word, overlaps, [0])).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      (CURATED as unknown as unknown[]).pop();
      warn.mockRestore();
    }
  });

  it('1,000 random within-batch orders on the curated plan: 0 stacking prompts, 0 tangles, every overlapping pair in the word\'s order', () => {
    const shuffle = shuffler(2468);
    let prompts = 0, tangles = 0;
    for (let r = 0; r < 1000; r++) {
      const res = simulate(PLAN, C, shuffle);
      prompts += res.prompts;
      tangles += res.tangles;
      expect(rightOrder(res.board), `run ${r}`).toBe(true);
    }
    expect({ prompts, tangles }).toEqual({ prompts: 0, tangles: 0 });
  });
});

describe('correct by construction: 1,000 random within-batch orders, 0 stacking prompts, 0 tangles', () => {
  // The plan is the same on desktop and phones (layout only changes the framing; the browser suite checks the live plan on
  // every profile), so "desktop" and "phone" are the same 1,000-run check; both starts are covered.
  for (const [name, start] of [['from the built c (3 of 32), as at Guide me', C], ['from nothing (the fallback, 0 of 32)', []]] as const) {
    it(name, () => {
      const plan = planBatches(CREATE, overlaps, start, OPT);
      const shuffle = shuffler(12345);
      let prompts = 0, tangles = 0, runs = 0;
      for (let r = 0; r < 1000; r++) {
        const res = simulate(plan, start, shuffle);
        prompts += res.prompts;
        tangles += res.tangles;
        expect(rightOrder(res.board), `run ${r}: every overlapping pair in the word's order`).toBe(true);
        runs++;
      }
      expect({ runs, prompts, tangles }).toEqual({ runs: 1000, prompts: 0, tangles: 0 });
      // Lowest first and highest first within each batch too.
      for (const o of [(b: readonly number[]) => [...b].sort((x, y) => x - y), (b: readonly number[]) => [...b].sort((x, y) => y - x)]) {
        const res = simulate(plan, start, o);
        expect([res.prompts, rightOrder(res.board)]).toEqual([0, true]);
      }
    });
  }

  it('for contrast: the same check ignoring the batches (any order over the whole word, as v1.3.0 allowed) does prompt', () => {
    const shuffle = shuffler(7);
    let prompts = 0;
    for (let r = 0; r < 50; r++) prompts += simulate([shuffle(CREATE.map((_, i) => i).filter((i) => !C.includes(i)))], C, (b) => b).prompts;
    expect(prompts).toBeGreaterThan(50);
  });
});

describe('the guide on the REAL word, batch by batch (guide.ts with the plan)', () => {
  const world = (pieces: readonly OutlinePiece[]): GuideWorld => ({ pieces, sizeOf: () => STEM, overlaps });
  const ps = (...is: number[]) => is.map((i) => ({ id: `p${i}`, ...CREATE[i] }));
  const at5 = () => observeGuide(startGuide(C.map((i) => CREATE[i]), world([])), world(ps(...C)));

  it('Guide me: "3 of 32", the first batch after the c; batch by batch to "32 of 32" with no prompt; progress counts done pieces', () => {
    let s = chooseWord(at5(), CREATE, world(ps(...C)), OPT);
    expect(s.batches).toEqual(PLAN);
    expect([s.step, currentBatch(s), activeOutlines(s), guideProgress(s)]).toEqual([6, 1, [3], { done: 3, total: 32 }]);
    const shuffle = shuffler(99);
    const board = [...C];
    for (let k = 1; k < PLAN.length; k++) {
      expect(activeOutlines(s), `batch ${k} shows, and only it`).toEqual(PLAN[k]);
      for (const i of shuffle(PLAN[k])) {
        board.push(i);
        s = observeGuide(s, world(ps(...board)));
        expect(s.stack, `no prompt after outline ${i}`).toBeNull();
        expect(guideProgress(s).done).toBe(board.length);
      }
    }
    expect([s.step, guideProgress(s)]).toEqual([7, { done: 32, total: 32 }]);
  });

  it('safety net: the visitor brings a placed lower piece forward over its upper partner: a prompt, its batch current again; fixed, back on track', () => {
    let s = chooseWord(at5(), CREATE, world(ps(...C)), OPT);
    const board = [...C, ...PLAN.slice(1, 5).flat()]; // four batches in
    s = observeGuide(s, world(ps(...board)));
    expect([currentBatch(s), s.stack]).toEqual([5, null]);
    // Bring forward outline 3 (the r's round): past the next piece above it that it overlaps.
    const ids = board.map((i) => `p${i}`);
    const ov = (a: string, b: string) => OV[Number(a.slice(1))][Number(b.slice(1))];
    const fwd = bringForwardOverlapping(ids, new Set(['p3']), ov)!;
    s = observeGuide(s, world(fwd.map((id) => ps(Number(id.slice(1)))[0])));
    expect(s.stack, 'a stacking prompt').not.toBeNull();
    expect(currentBatch(s), 'an earlier batch is current again').toBeLessThan(5);
    // The visitor follows the prompt with the action bar's presses: back on track, the batch it was on shows again.
    const pr = s.stack!;
    let order = fwd;
    for (let n = 0; n < pr.presses; n++) order = (pr.dir === 'back' ? sendBackwardOverlapping : bringForwardOverlapping)(order, new Set([pr.id]), ov)!;
    s = observeGuide(s, world(order.map((id) => ps(Number(id.slice(1)))[0])));
    expect([s.stack, currentBatch(s), activeOutlines(s)]).toEqual([null, 5, PLAN[5]]);
  });

  it('undo across batches: back into the previous batch (its outline shows again), redo forward; the plan never changes', () => {
    const h = new History<readonly OutlinePiece[]>(ps(...C));
    let s = chooseWord(at5(), CREATE, world(h.present), OPT);
    for (const i of [...PLAN[1], ...PLAN[2]]) {
      h.record([...h.present, ...ps(i)]);
      s = observeGuide(s, world(h.present));
    }
    expect([currentBatch(s), activeOutlines(s)]).toEqual([3, PLAN[3]]);
    s = observeGuide(s, world(h.undo()!)); // the last piece of batch 2 goes
    expect([currentBatch(s), activeOutlines(s).length]).toEqual([2, 1]);
    s = observeGuide(s, world(h.undo()!));
    s = observeGuide(s, world(h.undo()!)); // batch 1's piece goes too
    expect([currentBatch(s), activeOutlines(s), guideProgress(s).done]).toEqual([1, PLAN[1], 3]);
    s = observeGuide(s, world(h.redo()!));
    expect(currentBatch(s)).toBe(2);
    expect(s.batches).toEqual(PLAN);
  });
});
