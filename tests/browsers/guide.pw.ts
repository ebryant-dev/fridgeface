import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * The onboarding guide (copy v3 in v1.3.0: the c teaches stacking; "create" prompts the visitor to fix the stacking, never
 * reorders by itself; solid outlines for positive shapes, dotted for negative), in Chromium AND WebKit, desktop, iPhone
 * portrait and iPhone landscape: a blank board, the c built piece by piece onto outlines that pieces click into (guide
 * only): white oval, black oval (it covers the white), Send backward from the action bar, the wedge; step 5's
 * choice, the whole word "create" from Edward's REAL word-create-1 (32 pieces; v1.2.3: the c built is the word's own c, and
 * it stays in place at Guide me, exactly, counting as "3 of 32"; a c moved as one re-anchors the word), Skip / Don't show again / Next, replay from
 * Controls, no-guide, share links, Escape order, coexistence with the menu, sheet and dialog, placement in every layout,
 * reduced motion and axe. Step 0 (a saved board): Clear and start, Keep my pieces (outlines in empty board beside their
 * work), and the guide never touching their pieces. The "no word" case removes word-create-1 from the LIVE store at
 * runtime (nothing in src/suggestions/ is touched).
 */

// The other suites run with the guide turned off (playwright.config.ts); this one starts every visit fresh.
test.use({ storageState: { cookies: [], origins: [] } });

type P = { id: string; shapeId: string; x: number; y: number; rotation: number };
type O = { shapeId: string; x: number; y: number; rotation: number };
type FF = HTMLElement & {
  loadComposition(d: unknown): { ok: boolean };
  getShareUrl(): Promise<string>;
  getView(): { x: number; y: number; zoom: number };
  composition: { pieces: P[] };
  guide: {
    step: number; outlines: O[]; filled: (string | null)[]; done: boolean[]; turn: string | null; sections: number[][] | null;
    stack: { id: string; dir: 'back' | 'forward'; presses: number } | null;
  };
};

const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = { 'chromium-desktop': 'desktop', 'webkit-iphone': 'wk-iphone', 'webkit-iphone-landscape': 'wk-iphone-landscape' };
const C_TEXT = {
  1: 'Drag the white oval onto the fridge.', 2: 'Now drag the black oval onto it.', 3: 'Send the black oval back so the white shows through.', 4: 'Drag the wedge into place.',
};
const STACK_TEXT = { back: 'Send it back so it sits behind.', forward: 'Bring it forward so it sits in front.' };
const TURN = 'Now turn it with the round handle to fit.';
const TURN_TOUCH = 'Now turn it with the round handle to fit, or twist with two fingers.';

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const gbtn = (page: Page, id: string) => el(page, `.guide [data-guide=${id}]`);
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const pieces = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as FF).composition.pieces.map((p) => ({ ...p })));
const pieceCount = async (page: Page) => (await pieces(page)).length;
const state = (page: Page) => page.evaluate(() => {
  const g = (document.querySelector('fridge-face') as FF).guide;
  return {
    step: g.step, filled: [...g.filled], done: [...g.done], turn: g.turn, outlines: g.outlines.map((o) => ({ ...o })), sections: g.sections,
    stack: g.stack ? { id: g.stack.id, dir: g.stack.dir, presses: g.stack.presses } : null,
  };
});
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('fridgeface:guide:v2'));
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function ready(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
}

/** Load the page and wait for step 1. */
async function open(page: Page, url = '/?n=g') {
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
}

async function setNextMs(page: Page, ms: number) {
  await page.evaluate((ms) => { (customElements.get('fridge-face') as unknown as { guideNextMs: number }).guideNextMs = ms; }, ms);
}

/** The REAL word-create-1 (src/suggestions/word-create-1.json) is in the store: its piece count. */
async function realCreate(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { suggestionStore } = await import(/* @vite-ignore */ '/src/suggestion-store.ts' as string);
    return (suggestionStore.get('create', 1)?.pieces.length ?? 0) as number;
  });
}

/** Take word-create-1 out of the LIVE store (this page only; the file is untouched): step 4 as if it did not exist. */
async function dropCreate(page: Page) {
  await page.evaluate(async () => {
    const { suggestionStore } = await import(/* @vite-ignore */ '/src/suggestion-store.ts' as string);
    suggestionStore.remove('word-create-1.json');
  });
}

/** Board points to client px, through the component's camera (and its outlines' shape sizes). */
async function geo(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const board = sr.querySelector('.board')!;
    const b = board.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(board).getPropertyValue('--k'));
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const size: Record<string, number> = {};
    for (const s of SHAPES as { id: string; uprightBox: { w: number; h: number } }[]) size[s.id] = Math.max(s.uprightBox.w, s.uprightBox.h);
    return { left: b.left, top: b.top, k, view: ff.getView(), size };
  });
}
type Geo = Awaited<ReturnType<typeof geo>>;
const toClient = (g: Geo, p: { x: number; y: number }) => ({ x: g.left + (p.x * g.view.zoom + g.view.x) * g.k, y: g.top + (p.y * g.view.zoom + g.view.y) * g.k });

/** A mouse drag from `a` to `b` in steps (every profile delivers mouse events). */
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
}

/** Drag a shape from the tray and drop it close to outline `i` (offset by `off` of the shape's size, in board units). */
async function dropNear(page: Page, i: number, off = 0.08) {
  await frames(page);
  const s = await state(page);
  const o = s.outlines[i];
  const g = await geo(page);
  const d = off * g.size[o.shapeId];
  const to = toClient(g, { x: o.x + d * 0.8, y: o.y - d * 0.6 });
  const t = await el(page, `.tray button[data-shape="${o.shapeId}"]`).boundingBox();
  await drag(page, { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 }, to);
}

/** Turn the selected piece with its round handle to `target` degrees (plus `err`), in an arc about its centre. */
async function turnTo(page: Page, id: string, target: number, err = 4) {
  await frames(page);
  const p = (await pieces(page)).find((q) => q.id === id)!;
  const g = await geo(page);
  const c = toClient(g, p);
  const h = await el(page, '[data-handle] circle').first().boundingBox();
  const hx = h!.x + h!.width / 2, hy = h!.y + h!.height / 2;
  const rad = Math.hypot(hx - c.x, hy - c.y);
  const a0 = Math.atan2(hy - c.y, hx - c.x);
  const norm = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const delta = norm(target + err - p.rotation);
  const n = Math.max(4, Math.ceil(Math.abs(delta) / 8));
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((delta * Math.PI) / 180) * (i / n);
    await page.mouse.move(c.x + rad * Math.cos(a), c.y + rad * Math.sin(a));
  }
  await page.mouse.up();
}

/** Does a piece sit exactly on outline `o`? */
const onOutline = (p: P, o: O) => p.shapeId === o.shapeId && Math.hypot(p.x - o.x, p.y - o.y) < 0.2 && Math.abs(((p.rotation - o.rotation + 540) % 360) - 180) < 0.06;

/** The outline showing in the c's steps (1, 2, 4): its index. */
const activeOutline = async (page: Page) => Number(await el(page, '[data-outline]').first().getAttribute('data-outline'));

/**
 * Every overlapping pair (real geometry) of pieces on the word's outlines: in the word's order? Returns the pairs that are not.
 * Pairs that do not overlap never matter.
 */
async function misStacked(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const { convexIntersect, placeOutline } = await import(/* @vite-ignore */ '/src/selection.ts' as string);
    const hull = (id: string) => (SHAPES as { id: string; hull: unknown }[]).find((x) => x.id === id)!.hull;
    const g = ff.guide, ps = ff.composition.pieces;
    const pos = new Map(ps.map((p, i) => [p.id, i]));
    const by = new Map(ps.map((p) => [p.id, p]));
    const bad: number[][] = [];
    let pairs = 0;
    for (let i = 0; i < g.filled.length; i++) for (let j = i + 1; j < g.filled.length; j++) {
      const a = g.filled[i], b = g.filled[j];
      if (!a || !b) continue;
      const pa = by.get(a)!, pb = by.get(b)!;
      if (!convexIntersect(placeOutline(hull(pa.shapeId), pa), placeOutline(hull(pb.shapeId), pb))) continue;
      pairs++;
      if (pos.get(a)! > pos.get(b)!) bad.push([i, j]);
    }
    return { pairs, bad };
  });
}

/**
 * Fill two overlapping, unfilled outlines i < j front first (j, then i, each a new piece exactly on its outline, as a click-in
 * leaves it): i lands on top of j, which it belongs under, so the guide prompts. Returns [i, j].
 */
async function placeMisStacked(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as unknown as FF & { composition: { addPieces(o: O[]): { id: string }[] }; select(id: string | null): void };
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const { convexIntersect, placeOutline } = await import(/* @vite-ignore */ '/src/selection.ts' as string);
    const hull = (id: string) => (SHAPES as { id: string; hull: unknown }[]).find((x) => x.id === id)!.hull;
    const g = ff.guide;
    const open = g.outlines.map((_, i) => i).filter((i) => !g.filled[i] && (!g.sections || g.sections.find((sec) => sec.some((q) => !g.done[q]))!.includes(i)));
    for (const i of open) for (const j of open) {
      if (j <= i) continue;
      const a = g.outlines[i], b = g.outlines[j];
      if (!convexIntersect(placeOutline(hull(a.shapeId), a), placeOutline(hull(b.shapeId), b))) continue;
      ff.composition.addPieces([{ ...b }]);
      const [p] = ff.composition.addPieces([{ ...a }]);
      ff.select(p.id);
      return [i, j];
    }
    return null;
  });
}

/** Press an action-bar control (Send backward / Bring forward), as the visitor would. */
async function pressAction(page: Page, isMobile: boolean, action: 'backward' | 'forward') {
  await press(isMobile, el(page, `.actions [data-action=${action}]`));
}

/**
 * Answer every stacking prompt showing (step 6) by pressing the action-bar control it points at, checking on the way: the
 * prompt's words, the control it points at (and that it is not covered), the prompted piece selected. Returns the prompts
 * seen and the presses made.
 */
async function answerPrompts(page: Page, isMobile: boolean, label: string, check = true) {
  let prompts = 0, presses = 0, last = '';
  for (let guard = 0; guard < 80; guard++) {
    await frames(page);
    const s = await state(page);
    if (!s.stack || s.turn) break;
    const key = `${s.stack.id}:${s.stack.dir}`;
    if (key !== last) prompts++;
    last = key;
    const action = s.stack.dir === 'back' ? 'backward' : 'forward';
    await expect(el(page, '.guide .gt3')).toHaveText(STACK_TEXT[s.stack.dir]);
    await expect(guide(page)).toHaveAttribute('data-target', 'action');
    await expect(guide(page)).toHaveAttribute('data-action', action);
    expect(await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { selection: string[] }).selection), `${label}: the prompted piece is selected`).toEqual([s.stack.id]);
    if (check && prompts <= 2 && key !== '') await checkCallout(page, `${label}: stacking prompt ${prompts}`);
    await pressAction(page, isMobile, action);
    presses++;
    await expect.poll(async () => JSON.stringify((await state(page)).stack)).not.toBe(JSON.stringify(s.stack));
  }
  return { prompts, presses };
}

/**
 * The callout: inside the viewport and the board, clear of its target, the dock panels, the action bar and the tray, and
 * (v2) clear of every active outline and of the piece being turned toward one.
 */
async function checkCallout(page: Page, label: string, opts: { panned?: boolean; squeezed?: boolean } = {}) {
  await frames(page);
  const m = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const g = sr.querySelector<HTMLElement>('.guide')!;
    const shown = (e: HTMLElement) => !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const kind = g.dataset.target!;
    let target: { x: number; y: number; w: number; h: number } | null = null;
    if (kind === 'tray') target = rect(sr.querySelector('.tray')!);
    else if (kind === 'handle') target = rect(sr.querySelector('[data-handle] circle')!);
    else if (kind === 'piece') target = rect(sr.querySelector(`[data-piece-id="${g.dataset.piece}"] .bd`)!);
    else if (kind === 'action') target = rect(sr.querySelector(`.actions [data-action=${g.dataset.action}]`)!);
    const controls = [...sr.querySelectorAll<HTMLElement>('.dock > .panel, .actions')].filter(shown).map((e) => ({ name: e.className, r: rect(e) }));
    // An outline's box from its real geometry on screen (a rotated SVG element's own box overstates it), dots included.
    const outlines = [...sr.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => {
      const geom = g.querySelector<SVGGeometryElement>('path, polygon')!;
      const ctm = geom.getScreenCTM()!;
      const len = geom.getTotalLength();
      const pts = Array.from({ length: 96 }, (_, i) => geom.getPointAtLength((len * i) / 96)).map((q) => new DOMPoint(q.x, q.y).matrixTransform(ctm));
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), m = 1.5;
      return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
    });
    const turn = ff.guide.turn ? sr.querySelector(`[data-piece-id="${ff.guide.turn}"] .bd`) : null;
    const arrow = sr.querySelector('.gpt')!;
    // Every rotate handle showing, as its 44 px hit box (centred on the handle).
    const handles = [...sr.querySelectorAll('[data-handle]')].flatMap((h) => {
      const r = h.querySelector('circle')?.getBoundingClientRect();
      return r && r.width ? [{ x: r.x + r.width / 2 - 22, y: r.y + r.height / 2 - 22, w: 44, h: 44 }] : [];
    });
    return {
      kind, side: g.dataset.side, callout: rect(g), arrow: g.dataset.side === 'centre' ? null : rect(arrow), target, controls, outlines, handles,
      turn: turn ? rect(turn) : null, tray: rect(sr.querySelector('.tray')!), board: rect(sr.querySelector('.board')!), vw: window.innerWidth, vh: window.innerHeight,
    };
  });
  type R = { x: number; y: number; w: number; h: number };
  const ov = (a: R, b: R) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const inView = (r: R) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= m.vw + 0.5 && r.y + r.h <= m.vh + 0.5;
  const c = m.callout;
  const where = `${label}: callout ${JSON.stringify(c)} (${m.kind}, ${m.side})`;
  expect.soft(c.w > 0 && c.h > 0, `${where} has a size`).toBe(true);
  expect.soft(inView(c), `${where} inside the viewport`).toBe(true);
  expect.soft(c.x >= m.board.x - 0.5 && c.x + c.w <= m.board.x + m.board.w + 0.5 && c.y >= m.board.y - 0.5 && c.y + c.h <= m.board.y + m.board.h + 0.5, `${where} inside the board`).toBe(true);
  if (m.target) {
    expect.soft(ov(c, m.target), `${where} overlaps its target ${JSON.stringify(m.target)}`).toBe(false);
    if (m.arrow) expect.soft(ov(m.arrow, m.target), `${where}: the arrow ${JSON.stringify(m.arrow)} overlaps the target`).toBe(false);
  }
  for (const o of m.outlines) {
    expect.soft(ov(c, o), `${where} overlaps an active outline ${JSON.stringify(o)}`).toBe(false);
    if (!opts.panned) expect.soft(inView(o), `${label}: the outline ${JSON.stringify(o)} is inside the viewport`).toBe(true); // a visitor's pan may take it out
  }
  if (m.turn) expect.soft(ov(c, m.turn), `${where} overlaps the piece being turned ${JSON.stringify(m.turn)}`).toBe(false);
  for (const h of m.handles) expect.soft(ov(c, h), `${where} overlaps a rotate handle's 44px hit box ${JSON.stringify(h)}`).toBe(false);
  expect.soft(ov(c, m.tray), `${where} overlaps the tray`).toBe(false);
  // (squeezed: a pan put the rotate handle where the callout was, at the foot of a ~545 px board between the section and the
  // action bar: the callout's last resort puts handle and outlines first, the action bar may then be touched.)
  for (const k of m.controls) if (!(opts.squeezed && k.name.includes('actions'))) expect.soft(ov(c, k.r), `${where} overlaps ${k.name} ${JSON.stringify(k.r)}`).toBe(false);
  return m;
}

async function shoot(page: Page, project: string, name: string) {
  const n = NAMES[project];
  if (n) await page.screenshot({ path: `${SHOT}/g2-${name}-${n}.png` });
}

/** Step 3: the black oval covers the white one; the callout points at Send backward, the black oval selected. */
async function checkStep3(page: Page, label: string) {
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[3]);
  expect(await el(page, '[data-outline]').count(), 'no outline at step 3').toBe(0);
  await expect(el(page, '.actions')).toBeVisible();
  await expect(guide(page)).toHaveAttribute('data-target', 'action');
  await expect(guide(page)).toHaveAttribute('data-action', 'backward');
  const s = await state(page);
  const black = s.filled[s.outlines.findIndex((o) => o.shapeId === 'positive-round')]!;
  expect(s.stack).toEqual({ id: black, dir: 'back', presses: 1 });
  expect(await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { selection: string[] }).selection), 'the black oval is selected').toEqual([black]);
  await checkCallout(page, label);
  return black;
}

/** Build the c: white oval, black oval (covers it), Send backward, then the wedge dropped near (4a -> 4b) and turned in. */
async function buildC(page: Page, isMobile: boolean, project?: string, from = 1) {
  if (from === 1) await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(2);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[2]);
  if (project) {
    await checkCallout(page, 'step 2');
    await shoot(page, project, 'step2');
  }
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  await checkStep3(page, 'step 3');
  if (project) await shoot(page, project, 'step3');
  await pressAction(page, isMobile, 'backward');
  await expect.poll(async () => (await state(page)).step).toBe(4);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[4]);
  if (project) await checkCallout(page, 'step 4a');
  await dropNear(page, 2); // at rotation 0: close in position, 101 degrees off
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? TURN_TOUCH : TURN);
  const wedge = (await state(page)).turn!;
  if (project) {
    await checkCallout(page, 'step 4b');
    await shoot(page, project, 'step4b');
  }
  await turnTo(page, wedge, (await state(page)).outlines[2].rotation, 5); // 5 degrees past (101.22 + 5): still clicks in, exactly
  await expect.poll(async () => (await state(page)).step).toBe(5);
  return wedge;
}

test('blank start (no intro), then the c with the stacking lesson: white oval, black oval covers it, Send backward from the action bar, white shows, wedge; undo keeps the guide in step', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page, '/?n=c');
  expect(await pieceCount(page), 'the toy starts on a blank board').toBe(0);
  expect(await page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('[data-pieces] > [data-piece-id]').length)).toBe(0);
  // Non-modal: it never takes focus on load. Its words go to the polite live region.
  expect(await page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide'))).toBe(false);
  await expect(el(page, '#ff-live')).toContainText(C_TEXT[1]);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[1]);
  await expect(gbtn(page, 'skip')).toHaveText('Skip');
  await expect(gbtn(page, 'off')).toHaveText("Don't show again");
  await expect(gbtn(page, 'next')).toBeHidden();
  // ONE outline: the white oval, blueprint blue, DOTTED (a negative shape), about 2.75 screen px, no filters, no pointer events.
  const outline = () => page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const os = [...sr.querySelectorAll<SVGGElement>('[data-outline]')];
    const geom = os[0]?.querySelector('path, polygon');
    const layer = sr.querySelector('[data-outlines]')!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const zoom = (document.querySelector('fridge-face') as FF).getView().zoom;
    return {
      n: os.length, shape: os[0]?.dataset.shape, line: os[0]?.dataset.line, stroke: geom?.getAttribute('stroke'), dash: geom?.getAttribute('stroke-dasharray') ?? null,
      css: geom ? getComputedStyle(geom).strokeDasharray : '', px: Number(geom?.getAttribute('stroke-width')) * k * zoom, events: layer.getAttribute('pointer-events'),
      filters: sr.querySelectorAll('filter').length + [...sr.querySelectorAll('[data-pieces] *, [data-outlines] *')].filter((e) => getComputedStyle(e).filter !== 'none').length,
    };
  });
  const o1 = await outline();
  expect(o1).toMatchObject({ n: 1, shape: 'negative-round', line: 'dotted', stroke: '#378ADD', events: 'none', filters: 0 });
  expect(o1.dash, 'a negative shape: dotted').toBeTruthy();
  expect(o1.px).toBeGreaterThan(2.4);
  expect(o1.px).toBeLessThan(3.1);
  const m1 = await checkCallout(page, 'step 1');
  expect(m1.kind).toBe('tray');
  await shoot(page, info.project.name, 'step1');

  // The white oval, dropped close: it clicks EXACTLY into place, as part of the drop (one undo step).
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(2);
  let s = await state(page);
  let ps = await pieces(page);
  expect(ps).toHaveLength(1);
  expect(onOutline(ps[0], s.outlines[1]), 'exactly on its outline').toBe(true);
  await expect(el(page, '#ff-live')).toContainText('Clicked into place.');
  // Step 2: the black oval's outline, SOLID (a positive shape), the same weight.
  const o2 = await outline();
  expect(o2).toMatchObject({ n: 1, shape: 'positive-round', line: 'solid', stroke: '#378ADD', dash: null, css: 'none', filters: 0 });
  expect(o2.px).toBeCloseTo(o1.px, 1);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo removes the drop AND its click-in').toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await checkCallout(page, 'step 2');
  await shoot(page, info.project.name, 'step2');

  // The black oval lands ON TOP (a newly added piece): it hides the white oval. Nothing reorders it.
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'no auto-reorder: the black oval is on top, covering the white').toEqual(['negative-round', 'positive-round']);
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g6-step2-black-covers-desktop.png` }); // the white oval hidden
  const black = await checkStep3(page, 'step 3');
  await expect(el(page, '#ff-live')).toContainText(C_TEXT[3]);
  const nm = NAMES[info.project.name];
  if (nm === 'desktop' || nm === 'wk-iphone') await page.screenshot({ path: `${SHOT}/g6-step3-sendback-${nm}.png` });
  // Send backward, from the action bar the callout points at: ONE press steps past the white oval (overlap-aware).
  await pressAction(page, isMobile, 'backward');
  await expect.poll(async () => (await state(page)).step).toBe(4);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'the white shows through').toEqual(['positive-round', 'negative-round']);
  expect(ps[0].id).toBe(black);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[4]);
  // Undo the send-back: step 3 again (the guide follows the board); redo: step 4.
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');

  await checkCallout(page, 'step 4a');
  await dropNear(page, 2);
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? TURN_TOUCH : TURN);
  const wedge = (await state(page)).turn!;
  await checkCallout(page, 'step 4b');
  await shoot(page, info.project.name, 'step4b');
  await turnTo(page, wedge, (await state(page)).outlines[2].rotation, 5);
  await expect.poll(async () => (await state(page)).step).toBe(5);
  s = await state(page);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'stacking order of the c (as in word-create-1)').toEqual(['positive-round', 'negative-round', 'wedge']);
  ps.forEach((p, i) => expect(onOutline(p, s.outlines[i]), `piece ${i} exactly on its outline`).toBe(true));
  expect(ps[2].rotation, 'the c inside word-create-1: its wedge at 101.22 degrees').toBeCloseTo(101.22, 2);
  expect(ps[1].x - ps[0].x).toBeCloseTo(-0.4, 6); // arranged exactly as in the word
  expect(ps[1].y - ps[0].y).toBeCloseTo(4.0, 6);
  // Undo the turn: the wedge goes back (unturned, close) and the guide follows: 4b again. Redo: step 5.
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(async () => (await state(page)).turn).toBe(wedge);
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  // Robust: a clicked-in piece moved away shows its outline again (step 2), and moving it back fills it again.
  await page.evaluate(({ id }) => {
    const ff = document.querySelector('fridge-face') as unknown as { composition: { movePiece(id: string, x: number, y: number): boolean } } & FF;
    const p = ff.composition.pieces.find((q) => q.id === id)!;
    ff.composition.movePiece(id, p.x + 900, p.y);
  }, { id: black });
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  expect(await el(page, '[data-outline]').count()).toBe(1);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(errors).toEqual([]);
});

test('outline styles: a positive outline is SOLID and a negative one DOTTED, the same weight, blueprint blue (the word shows both)', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  await open(page, '/?n=styles');
  await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as unknown as { guideNextFill(): void };
    for (let i = 0; i < 4; i++) ff.guideNextFill(); // white, black, send back, wedge
  });
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await settled(page);
  const lines = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const zoom = (document.querySelector('fridge-face') as FF).getView().zoom;
    return [...sr.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => {
      const geom = g.querySelector('path, polygon')!;
      return {
        shape: g.dataset.shape!, line: g.dataset.line, stroke: geom.getAttribute('stroke'), dash: getComputedStyle(geom).strokeDasharray,
        px: Number(geom.getAttribute('stroke-width')) * k * zoom,
      };
    });
  });
  const positive = lines.filter((l) => l.shape.startsWith('positive'));
  const negative = lines.filter((l) => !l.shape.startsWith('positive'));
  expect(positive.length, 'positive outlines showing').toBeGreaterThan(0);
  expect(negative.length, 'negative outlines showing').toBeGreaterThan(0);
  for (const l of positive) expect([l.line, l.dash, l.stroke], `${l.shape}: solid`).toEqual(['solid', 'none', '#378ADD']);
  for (const l of negative) {
    expect([l.line, l.stroke], `${l.shape}: dotted`).toEqual(['dotted', '#378ADD']);
    expect(l.dash, `${l.shape}: a dash pattern`).not.toBe('none');
  }
  for (const l of lines) expect(l.px, 'the same weight').toBeCloseTo(2.75, 1);
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g6-outline-styles-desktop.png` });
});

test('step 5 without word-create-1: "That\'s a c." and only Clear for free play, which clears as ONE undoable step and ends the guide', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page, '/?n=4');
  await dropCreate(page);
  await buildC(page, isMobile);
  await expect(guide(page)).toBeVisible();
  await expect(el(page, '.guide .gt1')).toHaveText("That's a c.");
  await expect(el(page, '.guide .gt2'), 'no question without the word').toBeHidden();
  await expect(gbtn(page, 'word')).toBeHidden();
  await expect(gbtn(page, 'clear')).toBeVisible();
  await expect(gbtn(page, 'clear')).toHaveText('Clear for free play');
  await expect(gbtn(page, 'skip')).toBeHidden();
  await expect(gbtn(page, 'off')).toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines on step 5').toBe(0);
  const m = await checkCallout(page, 'step 5 (no word)');
  expect(m.side).toBe('centre');
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g2-step4-noword-desktop.png` });
  await press(isMobile, gbtn(page, 'clear'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(3);
  await expect(guide(page), 'the guide stays over').toBeHidden();
  expect(errors).toEqual([]);
});

/** The c's three pieces (by id) are exactly where they were: same place, rotation and stacking order among themselves. */
async function expectCInPlace(page: Page, c: P[], label: string) {
  const now = await pieces(page);
  const got = c.map((p) => now.find((q) => q.id === p.id));
  expect(got.every(Boolean), `${label}: the c's pieces are all still on the board`).toBe(true);
  got.forEach((q, i) => expect({ x: q!.x, y: q!.y, rotation: q!.rotation, shapeId: q!.shapeId }, `${label}: piece ${i} of the c did not move`).toEqual({ x: c[i].x, y: c[i].y, rotation: c[i].rotation, shapeId: c[i].shapeId }));
  const order = c.map((p) => now.findIndex((q) => q.id === p.id));
  expect([...order].sort((x, y) => x - y), `${label}: their stacking order among themselves`).toEqual(order);
}

/** Every outline of the word in the same board frame as the c: outlines 0, 1, 2 are exactly the c's pieces. */
async function expectWordOnC(page: Page, c: P[]) {
  const s = await state(page);
  expect(s.outlines.slice(0, 3).map((o, i) => onOutline(c[i], o)), 'the c\'s pieces sit exactly on their outlines').toEqual([true, true, true]);
  expect(s.filled.slice(0, 3), 'and count as filled').toEqual(c.map((p) => p.id));
  const shown = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => Number(g.dataset.outline)));
  expect(shown.filter((i) => i < 3), 'the c\'s outlines are not shown').toEqual([]);
}

test('the REAL word-create-1 (32 pieces) on a blank board: the c stays in place at Guide me (3 of 32), then every other outline in a shuffled order, answering each stacking prompt from the action bar (never reordered for the visitor), step 7, Start fresh, one undo restores', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'phones fill the word one section at a time (the section tests below)');
  test.setTimeout(400_000);
  const errors = collectErrors(page);
  await open(page, '/?n=w');
  const total = await realCreate(page);
  expect(total, 'Edward\'s create (flower)').toBe(32);
  await buildC(page, isMobile, info.project.name);
  await expect(el(page, '.guide .gt1')).toHaveText("That's a c.");
  await expect(el(page, '.guide .gt2')).toHaveText('Want to spell "create" next?');
  await expect(gbtn(page, 'word')).toHaveText('Guide me');
  await expect(gbtn(page, 'clear')).toHaveText('Clear for free play');
  await checkCallout(page, 'step 5');
  await shoot(page, info.project.name, 'step5');
  const c = await pieces(page);
  expect(c).toHaveLength(3);

  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expectCInPlace(page, c, 'Guide me'); // nothing cleared, nothing moved
  await expectWordOnC(page, c);
  await expect(el(page, '.guide .gt1')).toHaveText('Fill in the outlines to spell "create".');
  await expect(el(page, '.guide .gt2')).toHaveText(`3 of ${total}`);
  await expect(el(page, '#ff-live')).toContainText(`3 of ${total}`);
  await expect(gbtn(page, 'skip')).toBeVisible();
  await expect(gbtn(page, 'off')).toBeVisible();
  expect(await el(page, '[data-outline]').count(), 'the rest of the word at once').toBe(total - 3);
  await checkCallout(page, 'step 6');
  const small = await smallestTarget(page);
  info.annotations.push({ type: 'smallest target', description: `${small.px.toFixed(1)} CSS px (${small.shape}) at zoom ${small.zoom.toFixed(3)}` });
  // Undo at the start of step 6: Guide me added no undo step, so it takes back the c's last action (the wedge's turn) and
  // never the c itself; the guide stays on the word. Redo: 3 of 32 again.
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(async () => (await state(page)).filled[2]).toBeNull();
  expect(await pieceCount(page), 'the c is still on the board').toBe(3);
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect(el(page, '.guide .gt2')).toHaveText(`2 of ${total}`);
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(el(page, '.guide .gt2')).toHaveText(`3 of ${total}`);
  await expectCInPlace(page, c, 'undo and redo at the boundary');
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { select(id: string | null): void }).select(null));

  // A shuffled order (fixed seed), so pieces often land on top of pieces they belong under.
  const order = Array.from({ length: total - 3 }, (_, i) => i + 3);
  let seed = 7;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let prompts = 0, presses = 0, shot = false;
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const before = await pieceCount(page);
    const was = (await pieces(page)).map((p) => p.id);
    await dropNear(page, i);
    await expect.poll(() => pieceCount(page)).toBe(before + 1);
    let s = await state(page);
    if (!s.filled[i]) {
      // Close but mis-angled: the turning hint shows, then the handle turns it in.
      expect(s.turn, `outline ${i} needs turning`).not.toBeNull();
      await expect(el(page, '.guide .gt3')).toHaveText(isMobile ? TURN_TOUCH : TURN);
      if (n === 3) await checkCallout(page, 'step 6 turning');
      await turnTo(page, s.turn!, s.outlines[i].rotation, -4);
      await expect.poll(async () => (await state(page)).filled[i], `outline ${i} filled`).not.toBeNull();
      s = await state(page);
    }
    // No auto-reorder: the new piece is still on top, everything else in the order it was.
    const now = (await pieces(page)).map((p) => p.id);
    expect(now.slice(0, -1), `outline ${i}: the stacking order is untouched by the click-in`).toEqual(was);
    expect(now.at(-1)).toBe(s.filled[i]);
    if (s.stack && !shot && info.project.name === 'chromium-desktop') {
      await frames(page);
      await page.screenshot({ path: `${SHOT}/g6-create-prompt-desktop.png` });
      shot = true;
    }
    const a = await answerPrompts(page, isMobile, `outline ${i}`, prompts < 2);
    prompts += a.prompts;
    presses += a.presses;
    s = await state(page);
    expect((await misStacked(page)).bad, `after outline ${i}: no overlapping pair out of order`).toEqual([]);
    if (s.step === 6) await expect(el(page, '.guide .gt2')).toHaveText(`${n + 4} of ${total}`);
    if (n === 6) {
      await checkCallout(page, 'step 6 partly filled');
      expect(await el(page, '[data-outline]').count(), 'filled outlines disappear').toBe(total - 10);
    }
  }
  console.log(`[${info.project.name}] create, shuffled (seed 7): ${prompts} stacking prompts, ${presses} presses`);
  info.annotations.push({ type: 'stacking prompts', description: `${prompts} prompts, ${presses} presses` });
  expect(prompts, 'a shuffled order meets stacking prompts').toBeGreaterThan(0);
  await expect(guide(page)).toHaveAttribute('data-step', '7');
  await expect(el(page, '.guide .gt1')).toHaveText('You made "create". Now try your own name.');
  await expect(gbtn(page, 'fresh')).toHaveText('Start fresh');
  await expect(gbtn(page, 'keep')).toHaveText('Keep it');
  await expectCInPlace(page, c, 'the finished word');
  // Every piece on its outline, and the FINAL stacking order of every overlapping pair is the word's.
  const s = await state(page);
  const ps = await pieces(page);
  expect(ps.every((p) => s.outlines.some((o) => onOutline(p, o)))).toBe(true);
  const ms = await misStacked(page);
  expect(ms.pairs, 'the word has overlapping pairs').toBeGreaterThan(30);
  expect(ms.bad, 'every overlapping pair in the word\'s order').toEqual([]);
  await checkCallout(page, 'step 7');

  await press(isMobile, gbtn(page, 'fresh'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo restores the whole word').toBe(total);
  expect((await pieces(page)).map((p) => p.id)).toEqual(ps.map((p) => p.id));
  expect(errors).toEqual([]);
});

test('the c moved as one after step 4: the word is anchored on it where it now is (still 3 of 32, the c untouched)', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await open(page, '/?n=movedc');
  await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as unknown as { guideNextFill(): void };
    for (let i = 0; i < 4; i++) ff.guideNextFill();
  });
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  // Select all three and nudge them as one (Shift+Arrows: 10 units each), as the visitor might before choosing.
  const was = await pieces(page);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('Control+a');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await pieces(page)).map((p, i) => [Math.round(p.x - was[i].x), Math.round(p.y - was[i].y)]), 'moved as one').toEqual([[40, 20], [40, 20], [40, 20]]);
  await page.waitForTimeout(400); // the nudges are judged once they pause
  await expect(guide(page), 'still "That\'s a c."').toHaveAttribute('data-step', '5');
  const c = await pieces(page);
  const s4 = await state(page);
  c.forEach((p, i) => expect(onOutline(p, s4.outlines[i]), 'the c\'s outlines followed it').toBe(true));
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expectCInPlace(page, c, 'moved c, Guide me');
  await expectWordOnC(page, c);
  await expect(el(page, '.guide .gt2')).toHaveText('3 of 32');
});

test('no click-in outside the guide: after Skip (and with no-guide) a piece dropped right by where the outline was stays where it was dropped', async ({ page, browser }, info) => {
  await open(page, '/?n=nosnap');
  const first = await activeOutline(page);
  const o = (await state(page)).outlines[first];
  await dropNear(page, first);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await press(!!info.project.use.isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await press(!!info.project.use.isMobile, gbtn(page, 'skip'));
  await expect(guide(page)).toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines once the guide ends').toBe(0);
  // The same drop: no snapping at all.
  const g = await geo(page);
  const d = 0.08 * g.size[o.shapeId];
  const at = { x: o.x + d * 0.8, y: o.y - d * 0.6 };
  const t = await el(page, `.tray button[data-shape="${o.shapeId}"]`).boundingBox();
  await drag(page, { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 }, toClient(g, at));
  await expect.poll(() => pieceCount(page)).toBe(1);
  const p = (await pieces(page))[0];
  const landed = toClient(g, p), aimed = toClient(g, at);
  expect(Math.hypot(landed.x - aimed.x, landed.y - aimed.y), 'it landed where dropped (pointer rounding only)').toBeLessThan(2.5);
  expect(onOutline(p, o)).toBe(false);
  // A handle turn to within a degree or two of 0 stays where it is, too.
  await turnTo(page, p.id, 0, 3);
  const q = (await pieces(page))[0];
  expect(Math.abs(q.rotation)).toBeGreaterThan(1);

  // no-guide: the attribute, from the start.
  const ctx = await browser.newContext({ ...(info.project.use as Record<string, unknown>), storageState: { cookies: [], origins: [] } });
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') document.querySelector('fridge-face')?.setAttribute('no-guide', '');
    });
  });
  await p2.goto('/?n=nosnap2');
  await ready(p2);
  await p2.waitForTimeout(400);
  expect(await p2.locator('fridge-face [data-outline]').count()).toBe(0);
  const g2 = await geo(p2);
  const t2 = await p2.locator('fridge-face .tray button[data-shape="positive-round"]').boundingBox();
  const target = { x: g2.left + 300, y: g2.top + 200 };
  await drag(p2, { x: t2!.x + t2!.width / 2, y: t2!.y + t2!.height / 2 }, target);
  await expect.poll(() => pieceCount(p2)).toBe(1);
  const r = (await pieces(p2))[0];
  const c = toClient(g2, r);
  expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeLessThan(1.5);
  await ctx.close();
});

test('Next (after waiting, shortened timer) does the current thing for the visitor (fills the outline, or sends the black oval back), one undoable step each; keyboard only', async ({ page }) => {
  await open(page);
  await setNextMs(page, 200);
  await expect(gbtn(page, 'next')).toBeHidden(); // step 1's timer is the real 10 s one
  // Restart step 1 with the short timer: Controls -> Show guide is the replay; here Skip + Show guide via the API path.
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { replayGuide(): void }).replayGuide());
  await expect(gbtn(page, 'next')).toBeVisible();
  for (const step of ['2', '3', '4', '5']) {
    await gbtn(page, 'next').focus();
    await page.keyboard.press('Enter');
    await expect(guide(page)).toHaveAttribute('data-step', step);
    if (step === '3') expect((await pieces(page)).map((p) => p.shapeId), 'Next placed the black oval on top').toEqual(['negative-round', 'positive-round']);
    if (step !== '5') await expect(gbtn(page, 'next')).toBeVisible();
  }
  const ps = await pieces(page);
  const s = await state(page);
  expect(ps.map((p) => p.shapeId), 'Next sent the black oval back').toEqual(['positive-round', 'negative-round', 'wedge']);
  ps.forEach((p, i) => expect(onOutline(p, s.outlines[i])).toBe(true));
  await expect(gbtn(page, 'next'), 'step 5 has no Next').toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await page.keyboard.press('Control+z');
  await expect(guide(page), 'undoing Next\'s send-back').toHaveAttribute('data-step', '3');
});

test('Skip ends it for this visit; it comes back on the next one', async ({ page, isMobile }) => {
  await open(page);
  await press(isMobile, gbtn(page, 'skip'));
  await expect(guide(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  await page.waitForTimeout(500);
  await page.reload();
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
});

test("Don't show again survives a reload; Show guide in Controls replays it from step 1 without unsetting it", async ({ page, isMobile }) => {
  await open(page);
  await press(isMobile, gbtn(page, 'off'));
  await expect(guide(page)).toBeHidden();
  expect(await stored(page)).toBe('off');
  await page.reload();
  await ready(page);
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await el(page, '[data-menu=help]').tap();
  } else await el(page, '[data-view=help]').click();
  await expect(el(page, '.help')).toBeVisible();
  const replay = el(page, '[data-help=guide]');
  await expect(replay).toBeVisible();
  await expect(replay).toHaveText('Show guide');
  const showAll = el(page, '[data-help=showall]');
  if (await showAll.isVisible()) {
    await press(isMobile, showAll);
    await expect(replay, 'still there with every section shown').toBeVisible();
  }
  await press(isMobile, replay);
  await expect(el(page, '.help')).toBeHidden();
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).toBeVisible();
  expect(await el(page, '[data-outline]').count()).toBe(1);
  // A replay is asked for: focus moves into the callout.
  await expect.poll(() => page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide'))).toBe(true);
  expect(await stored(page), "replaying keeps Don't show again").toBe('off');
});

test('a share-link visit still shows the guide: the shared pieces are on the board, so step 0 asks first; Keep puts the c beside them', async ({ page, browser }, info) => {
  await open(page);
  const url = await page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    ff.loadComposition({ v: 1, pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }, { s: 'negative-round', x: 10, y: 0, r: 0 }] });
    return ff.getShareUrl();
  });
  expect(url).toContain('#c=');
  const ctx = await browser.newContext({ ...(info.project.use as Record<string, unknown>), storageState: { cookies: [], origins: [] } });
  const p = await ctx.newPage();
  await p.goto(url);
  await ready(p);
  await expect.poll(() => pieceCount(p)).toBe(2);
  await expect(guide(p)).toHaveAttribute('data-ask', '', { timeout: 5000 });
  await expect(guide(p)).toBeVisible();
  await expect(el(p, '.guide .gt1')).toHaveText('Start on a clean fridge?');
  await checkCallout(p, 'share link, step 0');
  await press(!!info.project.use.isMobile, gbtn(p, 'mine'));
  await expect(guide(p)).toHaveAttribute('data-step', '1');
  await p.waitForTimeout(300);
  await expect(guide(p), 'the loaded pieces did not complete step 1').toHaveAttribute('data-step', '1');
  await expectBeside(p, await pieces(p));
  await checkCallout(p, 'share link');
  await ctx.close();
});

test('no-guide: nothing shows, and Controls has no Show guide', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') document.querySelector('fridge-face')?.setAttribute('no-guide', '');
    });
  });
  await page.goto('/?n=noguide');
  await ready(page);
  await page.waitForTimeout(1000);
  await expect(guide(page)).toBeHidden();
  await expect(guide(page)).toHaveAttribute('data-step', '0');
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await el(page, '[data-menu=help]').tap();
  } else await el(page, '[data-view=help]').click();
  await expect(el(page, '.help')).toBeVisible();
  await expect(el(page, '[data-help=guide]')).toBeHidden();
});

test('Escape: the Letters sheet closes first, then the guide is skipped, then the selection clears', async ({ page }) => {
  await open(page);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('3'); // add (and select) a negative stem: not a guide shape, nothing clicks in
  await expect(el(page, '.actions')).toBeVisible();
  await page.keyboard.press('l');
  await expect(el(page, '.sugg')).toBeVisible();
  await expect(guide(page), 'hidden while the sheet is open').toBeHidden();
  await page.keyboard.press('Escape');
  await expect(el(page, '.sugg')).toBeHidden();
  await expect(guide(page), 'back after').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  expect(await el(page, '[data-outline]').count()).toBe(0);
  await expect(el(page, '.actions'), 'the selection is still there').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.actions')).toBeHidden();
});

test('coexistence: hidden while the Controls dialog or the phone menu is open, back after; Tab reaches its buttons', async ({ page, isMobile, browserName }) => {
  await open(page);
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await expect(el(page, '.menu')).toBeVisible();
    await expect(guide(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(el(page, '.menu')).toBeHidden();
    await expect(guide(page)).toBeVisible();
    await el(page, '[data-view=menu]').tap();
    await el(page, '[data-menu=help]').tap();
  } else await el(page, '[data-view=help]').click();
  await expect(el(page, '.help')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(el(page, '.help')).toBeHidden();
  await expect(guide(page)).toBeVisible();
  await checkCallout(page, 'after the dialog');
  const tabbable = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('.guide button')].map((b) => b.tagName === 'BUTTON' && b.tabIndex === 0));
  expect(tabbable.every(Boolean)).toBe(true);
  // WebKit (like Safari by default) does not Tab to buttons at all; the walk is checked in Chromium.
  if (browserName === 'webkit') {
    await press(isMobile, gbtn(page, 'skip'));
    await expect(guide(page)).toBeHidden();
    return;
  }
  await el(page, '.board svg.surface').focus();
  let reached = '';
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const a = document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null;
      return a?.closest('.guide') ? a.dataset.guide ?? '' : '';
    });
  }
  expect(reached, 'Tab reaches the callout').toBe('skip');
  await page.keyboard.press('Enter');
  await expect(guide(page)).toBeHidden();
  expect(await page.evaluate(() => (document.querySelector('fridge-face')!.shadowRoot!.activeElement as Element | null)?.getAttribute('class')), 'focus lands on the board').toBe('surface');
});

test('the callout and the outline follow the view and the window: still placed well after a zoom and a resize', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a desktop window can be resized freely');
  await open(page);
  const a = await checkCallout(page, 'before');
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  const b = await checkCallout(page, 'zoomed in');
  expect(b.outlines[0].w, 'the outline grew with the zoom').toBeGreaterThan(a.outlines[0].w * 1.3);
  const px = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    return Number(sr.querySelector('[data-outline] path, [data-outline] polygon')!.getAttribute('stroke-width')) * k * (document.querySelector('fridge-face') as FF).getView().zoom;
  });
  expect(px, 'its dots stay the same size on screen').toBeCloseTo(2.75, 1);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.setViewportSize({ width: 900, height: 640 });
  await checkCallout(page, 'resized');
  await page.setViewportSize({ width: 390, height: 700 }); // narrow: the compact layout
  await checkCallout(page, 'narrow');
});

test('reduced motion: the pointer does not move, and a click-in does not animate', async ({ browser }, info) => {
  for (const reduce of [false, true]) {
    const ctx = await browser.newContext({ ...(info.project.use as Record<string, unknown>), storageState: { cookies: [], origins: [] }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    await open(p);
    const running = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('.gpt svg')!.getAnimations().length);
    if (reduce) expect(running, 'no pointer animation with reduced motion').toBe(0);
    else expect(running, 'the pointer nudges toward the target').toBeGreaterThan(0);
    await dropNear(p, await activeOutline(p), 0.12);
    await expect.poll(async () => (await state(p)).step).toBe(2);
    const anims = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('[data-pieces] > [data-piece-id]')!.getAnimations().length);
    if (reduce) expect(anims, 'no settle with reduced motion').toBe(0);
    await ctx.close();
  }
});

test('axe: no violations with a callout showing (steps 1, 3, 4b, 5, 6 and a stacking prompt)', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  test.setTimeout(120_000);
  await open(page);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const run = () => page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(await run()).toEqual([]);
  await dropNear(page, await activeOutline(page));
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await dropNear(page, await activeOutline(page));
  await checkStep3(page, 'axe step 3');
  expect(await run(), 'step 3').toEqual([]);
  await pressAction(page, isMobile, 'backward');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await dropNear(page, 2);
  await expect(guide(page)).toHaveAttribute('data-turn', '');
  expect(await run()).toEqual([]);
  await turnTo(page, (await state(page)).turn!, (await state(page)).outlines[2].rotation, 0);
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(await run()).toEqual([]);
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await settled(page);
  expect(await run()).toEqual([]);
  // A stacking prompt: two overlapping outlines filled front piece first, so the back one lands on top of it.
  await placeMisStacked(page);
  await expect(guide(page)).toHaveAttribute('data-stack', '');
  await expect(guide(page)).toHaveAttribute('data-target', 'action');
  expect(await run(), 'a stacking prompt').toEqual([]);
});

test('storage that throws: the guide still shows, and "Don\'t show again" still ends it', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  });
  const errors = collectErrors(page);
  await open(page);
  await press(isMobile, gbtn(page, 'off'));
  await expect(guide(page)).toBeHidden();
  expect(errors).toEqual([]);
  void process;
});

test('with a callout showing, the board still works around it: a wrong shape dropped on open board stays put; compact hit areas stay 44px', async ({ page }) => {
  await open(page);
  await checkCallout(page, 'step 1');
  const hits = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.guide .gctl button:not([hidden])')].map((b) => {
    const r = b.getBoundingClientRect();
    const a = getComputedStyle(b, '::after');
    const px = (v: string) => parseFloat(v) || 0;
    return { h: r.height - px(a.top) - px(a.bottom), w: r.width - px(a.left) - px(a.right) };
  }));
  for (const h of hits) expect(h.h, 'hit area height').toBeGreaterThanOrEqual(44);
  // Open board: no callout, no control, no outline, with a margin.
  const spot = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const blocked = (x: number, y: number) => {
      const e = sr.elementFromPoint(x, y) as Element | null;
      return !e || !!e.closest('.guide, .dock, .actions, .tray, .menu, [data-piece-id]');
    };
    const ol = sr.querySelector('[data-outline]')!.getBoundingClientRect();
    const b = sr.querySelector('.board')!.getBoundingClientRect();
    for (let y = b.top + 60; y < b.bottom - 60; y += 20) for (let x = b.left + 60; x < b.right - 60; x += 20) {
      const far = x < ol.left - 80 || x > ol.right + 80 || y < ol.top - 80 || y > ol.bottom + 80;
      if (far && [[0, 0], [-30, -30], [30, 30], [-30, 30], [30, -30]].every(([dx, dy]) => !blocked(x + dx, y + dy))) return { x, y };
    }
    return null;
  });
  expect(spot, 'open board is reachable').not.toBeNull();
  const w = await el(page, '.tray button[data-shape="wedge"]').boundingBox();
  await drag(page, { x: w!.x + w!.width / 2, y: w!.y + w!.height / 2 }, spot!);
  await expect.poll(() => pieceCount(page)).toBe(1);
  const g = await geo(page);
  const at = toClient(g, (await pieces(page))[0]);
  expect(Math.hypot(at.x - spot!.x, at.y - spot!.y), 'it landed where it was dropped').toBeLessThan(2);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
});

// ---- step 0 (v1.2.1): a saved board ------------------------------------------------------------------------------

/** A saved composition, preloaded into the auto-save before the page loads. */
const SAVED = { v: 1, pieces: [
  { s: 'positive-stem', x: 0, y: 0, r: 0 }, { s: 'positive-round', x: 170, y: -60, r: 0 }, { s: 'negative-round', x: 172, y: -58, r: 0 },
  { s: 'wedge', x: 330, y: 40, r: 45 }, { s: 'negative-stem', x: 20, y: 0, r: 90 },
] };

async function preload(page: Page) {
  await page.addInitScript((c) => {
    try {
      if (!sessionStorage.getItem('ff-test-preloaded')) {
        localStorage.setItem('fridgeface:composition:v1', c);
        sessionStorage.setItem('ff-test-preloaded', '1');
      }
    } catch { /* storage blocked: nothing preloaded */ }
  }, JSON.stringify(SAVED));
}

/** Load the page with the saved board and wait for step 0. */
async function openAsk(page: Page, url = '/?n=ask') {
  await preload(page);
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-ask', '', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
  await expect.poll(() => pieceCount(page)).toBe(SAVED.pieces.length);
}

/** Board-space bounds (rotated) of pieces or outlines. */
async function boundsIn(page: Page, list: O[]) {
  return page.evaluate(async (list) => {
    const { rotatedBounds } = await import(/* @vite-ignore */ '/src/camera.ts' as string);
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    return rotatedBounds(list, (id: string) => SHAPES.find((s: { id: string }) => s.id === id)) as { x: number; y: number; w: number; h: number } | null;
  }, list);
}

/** The active outlines sit in empty board: clear of the bounds of `theirs` (every one of their pieces together). */
async function expectBeside(page: Page, theirs: P[]) {
  const s = await state(page);
  const active = s.outlines.filter((_, i) => !s.filled[i]);
  const a = await boundsIn(page, theirs), b = await boundsIn(page, active);
  expect(a && b, 'both have bounds').toBeTruthy();
  const ov = a!.x < b!.x + b!.w && b!.x < a!.x + a!.w && a!.y < b!.y + b!.h && b!.y < a!.y + a!.h;
  expect(ov, `the outlines ${JSON.stringify(b)} do not overlap their work ${JSON.stringify(a)}`).toBe(false);
}

/** The smallest active outline target on screen: its shape's shorter upright side, in CSS px at the current zoom. */
async function smallestTarget(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    const k = parseFloat(getComputedStyle(ff.shadowRoot!.querySelector('.board')!).getPropertyValue('--k'));
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const zoom = ff.getView().zoom;
    let best = { px: Infinity, shape: '', zoom };
    for (const o of ff.guide.outlines) {
      const u = (SHAPES as { id: string; uprightBox: { w: number; h: number } }[]).find((s) => s.id === o.shapeId)!.uprightBox;
      const px = Math.min(u.w, u.h) * zoom * k;
      if (px < best.px) best = { px, shape: o.shapeId, zoom };
    }
    return best;
  });
}

const same = (a: P[], b: P[]) => a.length === b.length && a.every((p, i) => {
  const q = b.find((r) => r.id === p.id);
  return !!q && q.shapeId === p.shapeId && q.x === p.x && q.y === p.y && q.rotation === p.rotation && i === b.indexOf(q);
});

test('step 0: a saved board on load asks "Start on a clean fridge?" with Clear and start, Keep my pieces, Skip and Don\'t show again', async ({ page }, info) => {
  const errors = collectErrors(page);
  await openAsk(page);
  await expect(guide(page)).toHaveAttribute('data-step', '0');
  await expect(el(page, '.guide .gt1')).toHaveText('Start on a clean fridge?');
  await expect(el(page, '.guide .gt2')).toBeHidden();
  await expect(gbtn(page, 'clean')).toHaveText('Clear and start');
  await expect(gbtn(page, 'mine')).toHaveText('Keep my pieces');
  await expect(gbtn(page, 'skip')).toBeVisible();
  await expect(gbtn(page, 'off')).toBeVisible();
  await expect(gbtn(page, 'next')).toBeHidden();
  for (const b of ['word', 'clear', 'fresh', 'keep']) await expect(gbtn(page, b)).toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines on step 0').toBe(0);
  await expect(el(page, '#ff-live')).toContainText('Start on a clean fridge?');
  const m = await checkCallout(page, 'step 0');
  expect(m.side).toBe('centre');
  const nm = NAMES[info.project.name];
  if (nm === 'desktop' || nm === 'wk-iphone') await page.screenshot({ path: `${SHOT}/g3-step0-${nm}.png` });
  // Show guide from Controls on a board with pieces asks again; Skip at step 0 ends it.
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { replayGuide(): void }).replayGuide());
  await expect(guide(page)).toHaveAttribute('data-ask', '');
  await press(!!info.project.use.isMobile, gbtn(page, 'skip'));
  await expect(guide(page)).toBeHidden();
  expect(await pieceCount(page)).toBe(SAVED.pieces.length);
  expect(errors).toEqual([]);
});

test('step 0 -> Clear and start: a blank board, the c built; undoing back past the c, ONE undo restores their pieces; the guide stays sane', async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await openAsk(page, '/?n=clean');
  const theirs = await pieces(page);
  await press(isMobile, gbtn(page, 'clean'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).not.toHaveAttribute('data-ask', '');
  expect(await pieceCount(page), 'blank board').toBe(0);
  await expect(el(page, '#ff-live')).toContainText('Undo brings it back.');
  await checkCallout(page, 'clear and start, step 1');
  await buildC(page, isMobile);
  expect(await pieceCount(page)).toBe(3);
  // Back through the c (turn, wedge, send-back, black oval, white oval): the guide follows to step 1 on a blank board.
  for (let i = 0; i < 5; i++) await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  // ONE more undo: every one of their pieces back, exactly (ids, places, rotations, stacking order).
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(theirs.length);
  expect(same(theirs, await pieces(page)), 'their pieces restored exactly').toBe(true);
  // Sane: still step 1, the c's outline moved beside their work (never on it), the callout well placed; redo clears again.
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).toBeVisible();
  await expectBeside(page, theirs);
  await checkCallout(page, 'after undoing Clear and start');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  expect(errors).toEqual([]);
});

test('step 0 -> Keep my pieces: the c beside their work; Clear for free play removes ONLY the c (one undo brings it back)', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await openAsk(page, '/?n=keepc');
  const theirs = await pieces(page);
  await press(isMobile, gbtn(page, 'mine'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  expect(same(theirs, await pieces(page)), 'their pieces untouched').toBe(true);
  await expectBeside(page, theirs);
  await checkCallout(page, 'keep, step 1');
  // Both in view where that keeps the c's targets big enough (it does, for a small composition, in every layout).
  const vis = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const b = sr.querySelector('.board')!.getBoundingClientRect();
    return [...sr.querySelectorAll('[data-pieces] > [data-piece-id] .bd')].some((e) => {
      const r = e.getBoundingClientRect();
      return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
    });
  });
  expect(vis, 'their work is in view').toBe(true);
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g3-keep-c-desktop.png` });
  const wedge = await buildC(page, isMobile);
  expect(wedge).toBeTruthy();
  const all = await pieces(page);
  expect(all).toHaveLength(theirs.length + 3);
  expect(same(theirs, all.filter((p) => theirs.some((t) => t.id === p.id))), 'their pieces still unchanged').toBe(true);
  await press(isMobile, gbtn(page, 'clear'));
  await expect(guide(page)).toBeHidden();
  await expect.poll(() => pieceCount(page)).toBe(theirs.length);
  expect(same(theirs, await pieces(page)), 'only the c went').toBe(true);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo brings the c back').toBe(theirs.length + 3);
  expect(errors).toEqual([]);
});

test('step 0 -> Keep my pieces -> the c -> Guide me: nothing cleared, "create" grows from the c beside their work (never over it); a few filled, then Start fresh removes ONLY the guide\'s pieces', async ({ page, isMobile }, info) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await openAsk(page, '/?n=keepw');
  const theirs = await pieces(page);
  await press(isMobile, gbtn(page, 'mine'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await buildC(page, isMobile);
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  const c = (await pieces(page)).filter((p) => !theirs.some((t) => t.id === p.id));
  expect(c).toHaveLength(3);
  await setNextMs(page, 50); // step 6's Next comes quickly (used for the rest of the word below)
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect.poll(() => pieceCount(page), 'nothing is cleared').toBe(theirs.length + 3);
  await expectCInPlace(page, c, 'keep, Guide me');
  await expectWordOnC(page, c);
  const left = await pieces(page);
  expect(same(theirs, left.filter((p) => theirs.some((t) => t.id === p.id))), 'their saved pieces unchanged').toBe(true);
  const total = await realCreate(page);
  await expect(el(page, '.guide .gt2')).toHaveText(`3 of ${total}`);
  // The WHOLE word (every outline, the c's included) is clear of their pieces' bounds.
  const all = await state(page);
  const a = await boundsIn(page, theirs), w = await boundsIn(page, all.outlines);
  expect(a!.x < w!.x + w!.w && w!.x < a!.x + a!.w && a!.y < w!.y + w!.h && w!.y < a!.y + a!.h, `the word ${JSON.stringify(w)} never overlaps their work ${JSON.stringify(a)}`).toBe(false);
  await expectBeside(page, theirs);
  await settled(page); // phones: the view glides to the first section
  await checkCallout(page, 'keep, step 6');
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g5-keep-word-desktop.png` });
  // The visitor adds a piece of their own during the word, not clicked in: it is theirs, never removed.
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('3'); // a negative stem, added in view
  await expect.poll(() => pieceCount(page)).toBe(theirs.length + 4);
  // ...and moves it well clear of everything (left of their work and the word), so no outline is anywhere near it.
  await page.evaluate(({ x }) => {
    const ff = document.querySelector('fridge-face') as unknown as { composition: { pieces: P[]; movePiece(id: string, x: number, y: number): boolean } };
    const p = ff.composition.pieces.at(-1)!;
    ff.composition.movePiece(p.id, x, p.y);
  }, { x: Math.min(a!.x, w!.x) - 1500 });
  const extra = (await pieces(page)).at(-1)!;
  const mineNow = [...theirs, extra];
  // A few outlines filled by hand (drag + turn when needed).
  for (let n = 3; n < 6; n++) {
    await settled(page);
    const s = await state(page);
    const i = Math.min(...s.outlines.map((_, j) => j).filter((j) => !s.filled[j] && (!s.sections || s.sections.find((sec) => sec.some((q) => !s.done[q]))!.includes(j))));
    await fillByHand(page, i);
    await answerPrompts(page, isMobile, `keep, outline ${i}`, false);
    await expect(el(page, '.guide .gt2')).toHaveText(`${n + 1} of ${total}`);
  }
  // The rest by Next (shortened timer, offered again after each bit of progress): it places pieces and fixes their stacking.
  for (let k = 0; k < 4 * total && (await state(page)).step === 6; k++) {
    await expect(gbtn(page, 'next')).toBeVisible();
    await gbtn(page, 'next').click({ force: true });
  }
  await expect(guide(page)).toHaveAttribute('data-step', '7');
  expect((await misStacked(page)).bad, 'Next left every overlapping pair in the word\'s order').toEqual([]);
  expect(await pieceCount(page), 'their pieces, and the word (the c included)').toBe(mineNow.length + total);
  await press(isMobile, gbtn(page, 'fresh'));
  await expect(guide(page)).toBeHidden();
  await expect.poll(() => pieceCount(page), 'Start fresh removed ONLY the guide-built word (the c with it)').toBe(mineNow.length);
  const end = await pieces(page);
  expect(same(theirs, end.filter((p) => theirs.some((t) => t.id === p.id))), 'their pieces unchanged at the end').toBe(true);
  expect(end.some((p) => p.id === extra.id)).toBe(true);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo brings the word back').toBe(mineNow.length + total);
  void info;
  expect(errors).toEqual([]);
});

test('step 0: no snapping outside the guide still holds after Skip at step 0', async ({ page, isMobile }) => {
  await openAsk(page, '/?n=asknosnap');
  await press(isMobile, gbtn(page, 'skip'));
  await expect(guide(page)).toBeHidden();
  // Drop a black oval exactly where the c's first outline WOULD go (centred in view): it stays where dropped.
  const g = await geo(page);
  const t = await el(page, '.tray button[data-shape="positive-round"]').boundingBox();
  const target = { x: g.left + 260, y: g.top + 240 };
  await drag(page, { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 }, target);
  await expect.poll(() => pieceCount(page)).toBe(SAVED.pieces.length + 1);
  const p = (await pieces(page)).at(-1)!;
  const c = toClient(g, p);
  expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeLessThan(2.5);
  expect(await el(page, '[data-outline]').count()).toBe(0);
});

test('axe: no violations at step 0', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await openAsk(page, '/?n=askaxe');
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const v = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((x) => `${x.id} (${x.nodes.length})`);
  });
  expect(v).toEqual([]);
});

// ---- phones (v1.2.2): the word one section at a time ------------------------------------------------------------

/** The REAL word-create-1's sections (src/sections.test.ts snapshots the same split from the shapes' frames). */
const CREATE_SECTIONS = [[1, 0, 2, 7, 4], [5, 3, 6, 8, 9], [10, 11, 13, 14, 12], [15, 24, 16, 17, 19, 18], [20, 22, 23, 21], [26, 28, 31], [25, 30, 29, 27]];

/** Wait until the view is still: no section framing pending, no glide running. */
async function settled(page: Page) {
  await frames(page);
  await page.waitForFunction(() => {
    const f = document.querySelector('fridge-face') as unknown as { viewGlide: number; wordFitPending: unknown };
    return !f.viewGlide && !f.wordFitPending;
  });
  await frames(page);
}

/** The outlines showing (their indices), and the smallest of them on screen (a shape's shorter side, CSS px). */
async function shown(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const idx = [...sr.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => Number(g.dataset.outline));
    let min = Infinity;
    for (const i of idx) {
      const u = (SHAPES as { id: string; uprightBox: { w: number; h: number } }[]).find((x) => x.id === ff.guide.outlines[i].shapeId)!.uprightBox;
      min = Math.min(min, Math.min(u.w, u.h) * ff.getView().zoom * k);
    }
    return { idx: idx.sort((a, b) => a - b), min };
  });
}

/**
 * Phones, the word by sections: how much of the word the view shows across, in letter-sections. `view` is the board's width
 * in board units at the current zoom; `avg` the average section's width and `cur` the current section's, from the real
 * outlines' tight bounds (the same measure the framing uses); `prevIn` whether at least half of the built section before it is in view.
 */
async function sectionSpan(page: Page) {
  return page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF & { tightBounds(o: O[]): { x: number; y: number; w: number; h: number } | null; viewport(): { width: number; height: number } };
    const g = ff.guide, sr = ff.shadowRoot!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const secs = g.sections!;
    const cur = secs.findIndex((sec) => sec.some((i) => !g.done[i]));
    const bs = secs.map((sec) => ff.tightBounds(sec.map((i) => g.outlines[i]))!);
    const avg = bs.reduce((a, b) => a + b.w, 0) / bs.length;
    const v = ff.getView(), vw = ff.viewport().width;
    const left = -v.x / v.zoom, right = (vw - v.x) / v.zoom; // board x range in view
    const inX = (b: { x: number; w: number }) => b.x >= left - 1 && b.x + b.w <= right + 1;
    const share = (b: { x: number; w: number }) => Math.max(0, Math.min(right, b.x + b.w) - Math.max(left, b.x)) / b.w; // the part of it in view
    return { view: vw / v.zoom, avg, cur: bs[cur].w, curIn: inX(bs[cur]), prevIn: cur > 0 ? share(bs[cur - 1]) >= 0.5 : null, k };
  });
}

/** Into step 6 on a blank board: the c by Next (it is tested above), then Guide me. The c stays: returns its pieces. */
async function toWord(page: Page, isMobile: boolean, project?: string): Promise<P[]> {
  await open(page, '/?n=sec');
  await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as unknown as { guideNextFill(): void };
    for (let i = 0; i < 4; i++) ff.guideNextFill();
  });
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  const c = await pieces(page);
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  expect(await pieceCount(page), 'the c stays').toBe(3);
  await expectCInPlace(page, c, 'Guide me (phone)');
  await expectWordOnC(page, c);
  await expect(el(page, '.guide .gt2')).toHaveText('3 of 32');
  if (project && NAMES[project] === 'wk-iphone') {
    await settled(page);
    await page.screenshot({ path: `${SHOT}/g5-guideme-wk-iphone.png` });
  }
  return c;
}

/** Fill outline `i` by hand: drop it close from the tray, turn it in with the handle when it needs turning. */
async function fillByHand(page: Page, i: number) {
  const before = await pieceCount(page);
  await dropNear(page, i);
  await expect.poll(() => pieceCount(page)).toBe(before + 1);
  const s = await state(page);
  if (!s.filled[i]) {
    expect(s.turn, `outline ${i} needs turning`).not.toBeNull();
    await turnTo(page, s.turn!, s.outlines[i].rotation, -4);
    await expect.poll(async () => (await state(page)).filled[i], `outline ${i} filled`).not.toBeNull();
  }
}

test('phones: the REAL create, section by section (shuffled within each), answering each stacking prompt from the action bar: only the current section shows, the view reframes, targets stay big, the final stacking order is the word\'s', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'desktop shows the whole word at once (the test above)');
  test.setTimeout(400_000);
  const errors = collectErrors(page);
  const c = await toWord(page, isMobile, info.project.name);
  const total = await realCreate(page);
  const sections = await page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.sections);
  expect(sections, 'the split of the real word').toEqual(CREATE_SECTIONS);
  const landscape = info.project.name.endsWith('landscape');
  const nm = NAMES[info.project.name];
  const mins: string[] = [];
  const spans: string[] = [];
  let lastView: { x: number; y: number; zoom: number } | null = null;
  let done = 3; // the c (outlines 0, 1, 2) is already in place: section 1 shows only its other outlines
  let seed = 11;
  let prompts = 0, presses = 0, promptShot = false;
  for (let k = 0; k < CREATE_SECTIONS.length; k++) {
    await settled(page);
    const sec = CREATE_SECTIONS[k].filter((i) => i > 2);
    const sh = await shown(page);
    expect(sh.idx, `section ${k + 1}: only its outlines show (the c's are filled)`).toEqual([...sec].sort((a, b) => a - b));
    if (k === 0) expect(sh.idx).toEqual([4, 7]);
    await expect(el(page, '.guide .gt1')).toHaveText('Fill in the outlines to spell "create".');
    await expect(el(page, '.guide .gt2')).toHaveText(`${done} of ${total}`);
    const view = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
    if (lastView) expect(view.x !== lastView.x || view.y !== lastView.y || view.zoom !== lastView.zoom, `section ${k + 1}: the view moved to it`).toBe(true);
    lastView = view;
    mins.push(sh.min.toFixed(1));
    const span = await sectionSpan(page);
    spans.push(`${(span.view / span.avg).toFixed(2)}${span.prevIn === null ? '' : span.prevIn ? '+' : '-'}`);
    expect(span.curIn, `section ${k + 1}: the current section is in view`).toBe(true);
    // v1.2.5: about TWO letters in view. The aim is up to 24 px targets, but the view is at most two average sections wide, so
    // a tall section (about 750 board units of stems and wedges) is limited by the height of the room the callout leaves:
    // measured 17 to 24 px (the thinnest stems and wedges; the rest are far larger). Edward accepted about 14 to 18 px.
    expect(sh.min, `section ${k + 1}: the thinnest target`).toBeGreaterThanOrEqual(14);
    // The measure of "about two letters": the board's width in the view, in AVERAGE sections (the same average the framing
    // zooms by, so the scale is steady from section to section). Portrait: 1.6 to 2.4, always. Landscape's board is only ~340
    // px tall, so a tall section sets the zoom (the view shows about 3 to 4 sections), never fewer than 1.6.
    expect(span.view / span.avg, `section ${k + 1}: letters in view`).toBeGreaterThanOrEqual(1.6);
    expect(span.view / span.avg, `section ${k + 1}: letters in view`).toBeLessThanOrEqual(landscape ? 4.2 : 2.4);
    await checkCallout(page, `section ${k + 1}`);
    if (nm === 'wk-iphone' && (k === 0 || k === 2)) await page.screenshot({ path: `${SHOT}/g4-section${k + 1}-wk-iphone.png` });
    if (nm === 'wk-iphone-landscape' && k === 0) await page.screenshot({ path: `${SHOT}/g4-section1-wk-iphone-landscape.png` });
    if ((nm === 'wk-iphone' || nm === 'wk-iphone-landscape') && k === 2) await page.screenshot({ path: `${SHOT}/zoom-create-s3-${nm}.png` });
    // A shuffled order within the section (fixed seed).
    const order = [...sec];
    for (let j = order.length - 1; j > 0; j--) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = Math.floor((seed / 233280) * (j + 1));
      [order[j], order[r]] = [order[r], order[j]];
    }
    for (let n = 0; n < order.length; n++) {
      if (n) await settled(page);
      await fillByHand(page, order[n]);
      if ((await state(page)).stack) {
        await settled(page);
        if (!promptShot && nm === 'wk-iphone') {
          await page.screenshot({ path: `${SHOT}/g6-create-prompt-wk-iphone.png` });
          promptShot = true;
        }
      }
      const a = await answerPrompts(page, isMobile, `section ${k + 1}, outline ${order[n]}`, prompts < 2);
      prompts += a.prompts;
      presses += a.presses;
      done++;
      if (done < total) await expect(el(page, '.guide .gt2')).toHaveText(`${done} of ${total}`);
    }
    // Earlier sections' pieces stay as real pieces on the board.
    expect(await pieceCount(page)).toBe(done);
  }
  info.annotations.push({ type: 'smallest target per section', description: mins.join(', ') + ' CSS px' });
  console.log(`[${info.project.name}] smallest target per section: ${mins.join(', ')} CSS px`);
  console.log(`[${info.project.name}] view width in average sections (+: half or more of the built section before it is in view): ${spans.join(', ')}`);
  expect(spans.filter((x) => x.endsWith('+')).length, `the built section before it shows as context in most sections (${spans.join(', ')})`).toBeGreaterThanOrEqual(4);
  console.log(`[${info.project.name}] create by sections, shuffled (seed 11): ${prompts} stacking prompts, ${presses} presses`);
  await expect(guide(page)).toHaveAttribute('data-step', '7');
  await settled(page);
  await expectCInPlace(page, c, 'the finished word (phone)');
  const s = await state(page);
  const ps = await pieces(page);
  expect(ps.every((p) => s.outlines.some((o) => onOutline(p, o))), 'every piece on its outline').toBe(true);
  expect((await misStacked(page)).bad, 'every overlapping pair in the word\'s stacking order').toEqual([]);
  // The finished word is framed: every piece in view.
  const inView = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const b = sr.querySelector('.board')!.getBoundingClientRect();
    return [...sr.querySelectorAll('[data-pieces] > [data-piece-id] .bd')].every((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    });
  });
  expect(inView, 'the finished word is framed').toBe(true);
  await checkCallout(page, 'step 7 (phone)');
  if (nm === 'wk-iphone') await page.screenshot({ path: `${SHOT}/g4-done-wk-iphone.png` });
  expect(errors).toEqual([]);
});

test('phones: undo back across a section boundary returns the view to that section; Next places the current section\'s next piece', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones only');
  test.setTimeout(120_000);
  await toWord(page, isMobile);
  // Fill section 1 with Next (one undoable step each): Next always fills the CURRENT section's lowest outline. Its c is
  // already filled, so that is its two other outlines.
  for (let n = 0; n < CREATE_SECTIONS[0].length - 3; n++) {
    await settled(page);
    const before = await state(page);
    const want = Math.min(...CREATE_SECTIONS[0].filter((i) => !before.filled[i]));
    await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
    await expect.poll(async () => (await state(page)).filled[want], `Next filled outline ${want}`).not.toBeNull();
    // Next restacks too, when the piece it placed landed on top of one it belongs under.
    for (let k = 0; k < 6 && (await state(page)).stack; k++) await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
    expect((await state(page)).stack).toBeNull();
  }
  await settled(page);
  expect((await shown(page)).idx, 'section 2 now').toEqual([...CREATE_SECTIONS[1]].sort((a, b) => a - b));
  const v2 = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
  await press(isMobile, el(page, '[data-history=undo]'));
  await settled(page);
  const back = await shown(page);
  expect(back.idx, 'back in section 1, its last outline showing').toHaveLength(1);
  expect(CREATE_SECTIONS[0]).toContain(back.idx[0]);
  const v1 = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
  expect(v1.x !== v2.x || v1.y !== v2.y || v1.zoom !== v2.zoom, 'the view went back to section 1').toBe(true);
  await checkCallout(page, 'undone into section 1');
  await press(isMobile, el(page, '[data-history=redo]'));
  await settled(page);
  expect((await shown(page)).idx).toEqual([...CREATE_SECTIONS[1]].sort((a, b) => a - b));
});

test('rotating or resizing mid-step switches modes without losing progress (portrait, landscape, desktop and back)', async ({ page, isMobile }, info) => {
  test.skip(info.project.name.endsWith('landscape'), 'portrait and desktop start points cover both directions');
  test.setTimeout(120_000);
  const start = page.viewportSize()!;
  if (!isMobile) await page.setViewportSize({ width: 393, height: 760 }); // a phone-sized window: the compact layout
  await toWord(page, isMobile);
  await settled(page);
  // One piece of section 1 by hand (its c is already filled).
  for (const i of [7]) {
    await fillByHand(page, i);
    await answerPrompts(page, isMobile, `outline ${i}`, false);
    await settled(page);
  }
  const progress = async () => (await state(page)).done.filter(Boolean).length;
  expect(await progress()).toBe(4);
  const sec1Rest = CREATE_SECTIONS[0].filter((i) => i > 2 && i !== 7).sort((a, b) => a - b);
  const sizes = [
    { name: 'landscape', w: 852, h: 393, sections: true },
    { name: 'desktop', w: 1280, h: 800, sections: false },
    { name: 'portrait', w: 393, h: 760, sections: true },
  ];
  for (const z of sizes) {
    await page.setViewportSize({ width: z.w, height: z.h });
    await expect.poll(async () => !!(await page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.sections)), `${z.name}: sections ${z.sections ? 'on' : 'off'}`).toBe(z.sections);
    await settled(page);
    expect(await progress(), `${z.name}: progress kept`).toBe(4);
    await expect(el(page, '.guide .gt2')).toHaveText('4 of 32');
    const sh = await shown(page);
    if (z.sections) expect(sh.idx, `${z.name}: still section 1`).toEqual(sec1Rest);
    else expect(sh.idx, `${z.name}: the whole word at once`).toHaveLength(28);
    await checkCallout(page, `after switching to ${z.name}`);
  }
  // Pieces placed before the switches are still valid: finishing section 1 moves on to section 2.
  for (const i of sec1Rest) {
    await fillByHand(page, i);
    await answerPrompts(page, isMobile, `outline ${i}`, false);
    await settled(page);
  }
  expect((await shown(page)).idx).toEqual([...CREATE_SECTIONS[1]].sort((a, b) => a - b));
  await page.setViewportSize(start);
});

// ---- v1.2.4: the callout never covers a rotate handle ---------------------------------------------------------------

type FFi = FF & {
  k: number;
  setSelection(ids: string[]): void;
  render(): void;
  setView(c: { x: number; y: number; zoom: number }): void;
  composition: FF['composition'] & {
    addPieces(items: { shapeId: string; x: number; y: number; rotation: number }[]): { id: string }[];
    setPlacements(items: { id: string; x: number; y: number; rotation: number }[]): void;
    getPiece(id: string): P | undefined;
  };
};

/** A negative stem of the visitor's own (not part of the c), added in view near the board's centre: its id. */
async function addStem(page: Page, dx = 0, shapeId = 'negative-stem'): Promise<string> {
  return page.evaluate(({ dx, shapeId }) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    const b = ff.shadowRoot!.querySelector('.board')!.getBoundingClientRect();
    const v = ff.getView();
    const x = (b.width / 2 / ff.k - v.x) / v.zoom + dx, y = (b.height / 2 / ff.k - v.y) / v.zoom;
    return ff.composition.addPieces([{ shapeId, x, y, rotation: 0 }])[0].id;
  }, { dx, shapeId });
}

/**
 * Select `ids` and move them (or, with `pan`, the view) so their rotate handle lands on the CENTRE of where the callout sits
 * now; then the callout must have stepped aside: its box never intersects any handle's 44 px hit box.
 */
async function handleProbe(page: Page, label: string, ids: string[], pan = false) {
  await frames(page);
  await expect(guide(page)).toBeVisible();
  const where = await guide(page).boundingBox();
  const target = { x: where!.x + where!.width / 2, y: where!.y + where!.height / 2 };
  const view0 = await page.evaluate(() => (document.querySelector('fridge-face') as unknown as FFi).getView());
  await page.evaluate(async ({ ids, target, pan }) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    ff.setSelection(ids);
    ff.render();
    for (let i = 0; i < 5; i++) {
      await raf();
      const h = ff.shadowRoot!.querySelector('[data-handle] circle')!.getBoundingClientRect();
      const dx = target.x - (h.x + h.width / 2), dy = target.y - (h.y + h.height / 2);
      if (Math.hypot(dx, dy) < 1) break;
      const v = ff.getView();
      if (pan) ff.setView({ x: v.x + dx / ff.k, y: v.y + dy / ff.k, zoom: v.zoom });
      else {
        const s = ff.k * v.zoom;
        ff.composition.setPlacements(ids.map((id) => {
          const p = ff.composition.getPiece(id)!;
          return { id, x: p.x + dx / s, y: p.y + dy / s, rotation: p.rotation };
        }));
        ff.render();
      }
    }
  }, { ids, target, pan });
  await frames(page);
  await frames(page);
  await expect(guide(page)).toBeVisible();
  const m = await checkCallout(page, `${label} (handle moved under it${pan ? ' by panning' : ''})`, { panned: pan, squeezed: pan && label === 'step 6' });
  expect(m.handles.length, `${label}: a handle shows`).toBeGreaterThan(0);
  const ov = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const h of m.handles) expect(ov(m.callout, h), `${label}: the callout ${JSON.stringify(m.callout)} is clear of the handle ${JSON.stringify(h)}`).toBe(false);
  // The pan was only to put the handle under the callout: put the view back, so the next step starts framed as the guide left it.
  if (pan) {
    await page.evaluate((v) => (document.querySelector('fridge-face') as unknown as FFi).setView(v), view0);
    await frames(page);
  }
  return m;
}

test('the callout never covers a rotate handle: a selected piece (or a selection) moved under it, in steps 1 to 6, and by panning', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await open(page, '/?n=h');
  const a = await addStem(page);
  await handleProbe(page, 'step 1', [a]);
  await handleProbe(page, 'step 1', [a], true);
  if (info.project.name === 'webkit-iphone') await page.screenshot({ path: `${SHOT}/handle-clear-wk-iphone.png` });
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(2);
  await handleProbe(page, 'step 2', [a]);
  const b = await addStem(page, 60);
  await handleProbe(page, 'step 2, a selection of two', [a, b]);
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  // Step 3 points at Send backward with the black oval selected: its own handle is never covered.
  const black = await checkStep3(page, 'step 3, the black oval selected');
  await handleProbe(page, 'step 3', [black], true); // panned: moving the black oval would take it off its outline
  await page.evaluate((id) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    ff.setSelection([id]);
    ff.render();
  }, black);
  await pressAction(page, isMobile, 'backward');
  await expect.poll(async () => (await state(page)).step).toBe(4);
  await handleProbe(page, 'step 4a', [a]);
  await dropNear(page, 2);
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  const wedge = (await state(page)).turn!;
  await handleProbe(page, 'step 4b, another piece selected', [a]);
  await page.evaluate((id) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    ff.setSelection([id]);
    ff.render();
  }, wedge);
  await checkCallout(page, 'step 4b, the wedge selected');
  await turnTo(page, wedge, (await state(page)).outlines[2].rotation, 3);
  await expect.poll(async () => (await state(page)).step).toBe(5);
  await handleProbe(page, 'step 5', [a, b]);
  if (await realCreate(page)) {
    // The visitor's two stems were moved under the callout at the c's close-up (scale-dependent board spots, now beside the c).
    // They are not part of what this probe tests: take them off before Guide me (stray pieces would make it place the word
    // clear of them, not on the c), and use a fresh one for step 6.
    await page.evaluate((ids) => (document.querySelector('fridge-face') as unknown as { composition: { deletePieces(ids: string[]): number } }).composition.deletePieces(ids), [a, b]);
    await press(isMobile, gbtn(page, 'word'));
    await expect(guide(page)).toHaveAttribute('data-step', '6');
    await page.waitForTimeout(700); // phones: the view glides to the first section
    // A white oval, not a stem: at the section's close-up a stem is about 175 px tall, and one panned to the callout's place
    // at the foot of the board leaves the callout nowhere to go (a corner, not what this checks).
    const a5 = await addStem(page, 0, 'negative-round');
    await handleProbe(page, 'step 6', [a5]);
    await handleProbe(page, 'step 6', [a5], true);
  }
  expect(errors).toEqual([]);
});

test('v1.2.4 symmetry: an oval half a turn round clicks in where it is (no spin) and counts as filled; the wedge half a turn round does not', async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, '/?n=sym');
  const release = (shapeId: string, i: number, turn: number) => page.evaluate(({ shapeId, i, turn }) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi & { guideSnap(ids: string[]): void };
    const o = ff.guide.outlines[i];
    const [p] = ff.composition.addPieces([{ shapeId, x: o.x + 4, y: o.y - 3, rotation: o.rotation + turn }]);
    const before = ff.composition.getPiece(p.id)!.rotation;
    ff.guideSnap([p.id]); // what a drop / drag end / turn end calls
    const after = ff.composition.getPiece(p.id)!;
    return { id: p.id, before, after: { ...after }, outline: { ...o } };
  }, { shapeId, i, turn });
  const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const white = await release('negative-round', 1, 180 + 6);
  expect([white.after.x, white.after.y], 'exactly in place').toEqual([white.outline.x, white.outline.y]);
  expect(gap(white.after.rotation, white.before), 'turned only the 6 degrees it was off, not half a turn').toBeCloseTo(6, 6);
  expect(gap(white.after.rotation, white.outline.rotation), 'half a turn from the outline: the same oval').toBeCloseTo(180, 6);
  await expect.poll(async () => (await state(page)).step, 'the white oval counts as filled').toBe(2);
  const black = await release('positive-round', 0, -180 - 4);
  expect(gap(black.after.rotation, black.before)).toBeCloseTo(4, 6);
  await expect.poll(async () => (await state(page)).step, 'on top of the white one: send it back').toBe(3);
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
  await expect.poll(async () => (await state(page)).step).toBe(4);
  const wedge = await release('wedge', 2, 180);
  expect(wedge.after.rotation, 'the wedge did not click in').toBeCloseTo(wedge.before, 6);
  await expect.poll(async () => (await state(page)).turn, 'it needs turning (4b)').toBe(wedge.id);
  expect(errors).toEqual([]);
});
