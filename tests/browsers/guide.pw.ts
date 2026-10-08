import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * The onboarding guide (copy v4 in v1.6.0: the c teaches stacking, wedge first; "create" prompts the visitor to fix the
 * stacking, never reorders by itself; solid outlines for positive shapes, dotted for negative), in Chromium AND WebKit,
 * desktop, iPhone portrait and iPhone landscape: a blank board, the c built piece by piece onto outlines that pieces click
 * into (guide only): the wedge (its outline first at the angle it lands at; dropped there it clicks into position, then
 * the outline shows its true angle and the visitor turns it in), the black oval and the white oval (they cover the wedge),
 * Bring forward from the button block until the wedge cuts in; step 5's
 * choice, the whole word "create" from Edward's REAL word-create-1 (32 pieces; v1.2.3: the c built is the word's own c, and
 * it stays in place at Guide me, exactly, counting as "3 of 32"; a c moved as one re-anchors the word; v1.4.0: built in
 * stacking order, batch by batch, with no stacking prompt, which remains only as a safety net), Skip / Don't show again / Next, replay from
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
    step: number; outlines: O[]; filled: (string | null)[]; done: boolean[]; turn: string | null; batches: number[][] | null;
    stack: { id: string; dir: 'back' | 'forward'; presses: number } | null;
  };
};

const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = { 'chromium-desktop': 'desktop', 'webkit-iphone': 'wk-iphone', 'webkit-iphone-landscape': 'wk-iphone-landscape' };
const C_TEXT = {
  1: 'Drag the wedge onto the fridge.', 2: 'Now drag the black oval into place.', 3: 'Now drag the white oval onto it.', 4: 'Bring the wedge forward so it cuts into the black.',
};
/** Where the copy v4 walk-through saves its phone screenshots (FF_SHOTS; default the usual scratch folder). */
const SHOTS = process.env.FF_SHOTS || SHOT;
const STACK_TEXT = { back: 'Send it back so it sits behind.', forward: 'Bring it forward so it sits in front.' };
const TURN = 'Now turn it with the round handle to fit.';
const TURN_TOUCH = 'Now turn it with the round handle to fit, or twist with two fingers.';

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const gbtn = (page: Page, id: string) => el(page, `.guide [data-guide=${id}]`);
/** The guide bar's buttons (v1.6.3): back, next, exit. */
const bbtn = (page: Page, id: 'back' | 'next' | 'exit') => el(page, `.gbar [data-gbar=${id}]`);
const gbar = (page: Page) => el(page, '.gbar');
/** The callout's buttons showing (v1.6.3: none on an instruction step). */
const calloutButtons = (page: Page) => el(page, '.guide button:visible');
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const pieces = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as FF).composition.pieces.map((p) => ({ ...p })));
/** The c's pieces in OUTLINE order (black oval, white oval, wedge), whatever their stacking order: v1.6.2, the white oval and the wedge may be either way round. */
const C_ORDER = ['positive-round', 'negative-round', 'wedge'];
const inOutlineOrder = <T extends { shapeId: string }>(ps: T[]) => [...ps].sort((a, b) => C_ORDER.indexOf(a.shapeId) - C_ORDER.indexOf(b.shapeId));
const pieceCount = async (page: Page) => (await pieces(page)).length;
const state = (page: Page) => page.evaluate(() => {
  const g = (document.querySelector('fridge-face') as FF).guide;
  return {
    step: g.step, filled: [...g.filled], done: [...g.done], turn: g.turn, outlines: g.outlines.map((o) => ({ ...o })), batches: g.batches,
    stack: g.stack ? { id: g.stack.id, dir: g.stack.dir, presses: g.stack.presses } : null,
  };
});
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('fridgeface:guide:v2'));
/**
 * Undo / redo from the keyboard. v1.6.0: on phones a callout pointing at the tray (or at Forward) may sit over the button
 * block, right by its target (the controls are no longer obstacles to it), so its Undo / Redo may be covered there.
 */
async function historyKey(page: Page, kind: 'undo' | 'redo') {
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press(kind === 'undo' ? 'Control+z' : 'Control+Shift+z');
}
/** A click-in glides the piece into place (170 ms); the callout is placed again once it lands. */
const landed = async (page: Page) => {
  await page.waitForTimeout(260);
  await frames(page);
};
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

/** Load the page on a blank board and wait for step 0's welcome question ("Would you like a tutorial?"). */
async function openWelcome(page: Page, url = '/?n=w') {
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  await expect(guide(page)).toHaveAttribute('data-step', '0');
  await expect(guide(page)).toBeVisible();
}

/** Load the page and wait for step 1 (v1.6.1: answering the welcome question with Yes first, when it is asked). */
async function open(page: Page, url = '/?n=g') {
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-step', /^[01]$/, { timeout: 5000 });
  if (await guide(page).getAttribute('data-welcome') !== null) await gbtn(page, 'yes').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
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

/** The outline showing in the c's steps (1, 2, 3): its index. */
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
    // Same-colour pairs (v1.6.2: two black or two white shapes) are left out: either order is right.
    const pol = (id: string) => (SHAPES as { id: string; polarity: string }[]).find((x) => x.id === id)!.polarity;
    let pairs = 0;
    for (let i = 0; i < g.filled.length; i++) for (let j = i + 1; j < g.filled.length; j++) {
      const a = g.filled[i], b = g.filled[j];
      if (!a || !b) continue;
      const pa = by.get(a)!, pb = by.get(b)!;
      if (pol(pa.shapeId) === pol(pb.shapeId)) continue;
      if (!convexIntersect(placeOutline(hull(pa.shapeId), pa), placeOutline(hull(pb.shapeId), pb))) continue;
      pairs++;
      if (pos.get(a)! > pos.get(b)!) bad.push([i, j]);
    }
    return { pairs, bad };
  });
}

/**
 * The safety net (v1.4.0): pick a PLACED word piece that has a placed partner above it which it overlaps (real geometry),
 * and select it, so the visitor can bring it forward out of order. Returns its outline index and id, or null.
 */
async function selectPlacedLower(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as unknown as FF & { select(id: string | null): void };
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const { convexIntersect, placeOutline } = await import(/* @vite-ignore */ '/src/selection.ts' as string);
    const hull = (id: string) => (SHAPES as { id: string; hull: unknown }[]).find((x) => x.id === id)!.hull;
    const g = ff.guide;
    const ps = ff.composition.pieces;
    const pos = new Map(ps.map((p, k) => [p.id, k]));
    const pol = (id: string) => (SHAPES as { id: string; polarity: string }[]).find((x) => x.id === id)!.polarity;
    // v1.6.2: the piece's NEXT overlapping piece above it (the one Bring forward passes) must be the other colour, or the press is not a mistake.
    for (let i = g.filled.length - 1; i >= 0; i--) {
      const a = g.filled[i];
      if (!a) continue;
      let next: number | null = null;
      for (let j = 0; j < g.filled.length; j++) {
        const b = g.filled[j];
        if (j === i || !b || pos.get(b)! < pos.get(a)!) continue;
        if (!convexIntersect(placeOutline(hull(g.outlines[i].shapeId), g.outlines[i]), placeOutline(hull(g.outlines[j].shapeId), g.outlines[j]))) continue;
        if (next === null || pos.get(b)! < pos.get(g.filled[next]!)!) next = j;
      }
      if (next === null || pol(g.outlines[next].shapeId) === pol(g.outlines[i].shapeId)) continue;
      ff.select(a);
      return { i, id: a };
    }
    return null;
  });
}

/** Press an action-bar control (Send backward / Bring forward), as the visitor would. */
async function pressAction(page: Page, isMobile: boolean, action: 'backward' | 'forward') {
  await press(isMobile, el(page, `.block [data-block=${action}]`));
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
 * The callout: inside the viewport and the board, clear of its target (the tray shape it names, the Back / Forward it names,
 * the rotate handle), of the piece a stacking prompt acts on, of every active outline and of the piece being turned toward
 * one. Since v1.6.0 it MAY cover the dock panels, the button block and the rest of the tray (it sits close to its target).
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
    if (kind === 'tray') target = rect(g.dataset.shape ? sr.querySelector(`.tray button[data-shape="${g.dataset.shape}"]`)! : sr.querySelector('.tray')!);
    else if (kind === 'handle') target = rect(sr.querySelector('[data-handle] circle')!);
    else if (kind === 'piece') target = rect(sr.querySelector(`[data-piece-id="${g.dataset.piece}"] .bd`)!);
    else if (kind === 'action') target = rect(sr.querySelector(`.block [data-block=${g.dataset.action}]`)!);
    // (The callout points at a tray shape's SLICE of the tray: its column across the tray's height, its row in the
    // landscape column. `slice` is that, for measuring how far it stands from what it points at.)
    let slice = target;
    if (kind === 'tray' && g.dataset.shape && target) {
      const tray = rect(sr.querySelector('.tray')!);
      slice = sr.querySelector('.root')!.hasAttribute('data-landscape') ? { x: tray.x, y: target.y, w: tray.w, h: target.h } : { x: target.x, y: tray.y, w: target.w, h: tray.h };
    }
    const controls = [...sr.querySelectorAll<HTMLElement>('.dock > .panel')].filter(shown).map((e) => ({ name: e.className, r: rect(e) }));
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
    const acted = kind === 'action' && ff.guide.stack ? sr.querySelector(`[data-piece-id="${ff.guide.stack.id}"] .bd`) : null;
    const arrow = sr.querySelector('.gpt')!;
    // Every rotate handle showing, as its 44 px hit box (centred on the handle).
    const handles = [...sr.querySelectorAll('[data-handle]')].flatMap((h) => {
      const r = h.querySelector('circle')?.getBoundingClientRect();
      return r && r.width ? [{ x: r.x + r.width / 2 - 22, y: r.y + r.height / 2 - 22, w: 44, h: 44 }] : [];
    });
    return {
      slice,
      bar: (() => { const b = sr.querySelector<HTMLElement>('.gbar')!; return b.hidden ? null : rect(b); })(),
      portrait: (() => { const r = sr.querySelector('.root')!; return r.hasAttribute('data-compact') && !r.hasAttribute('data-landscape'); })(),
      kind, side: g.dataset.side, callout: rect(g), arrow: g.dataset.side === 'centre' ? null : rect(arrow), noarrow: g.hasAttribute('data-noarrow'), target, controls, outlines, handles,
      phase: (ff.guide as unknown as { phase: string }).phase, turn: turn ? rect(turn) : null, acted: acted ? rect(acted) : null, tray: rect(sr.querySelector('.tray')!), board: rect(sr.querySelector('.board')!), vw: window.innerWidth, vh: window.innerHeight,
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
  // The target stays fully visible: inside the viewport too.
  if (m.target) expect.soft(inView(m.target), `${where}: its target ${JSON.stringify(m.target)} is in the viewport`).toBe(true);
  if (m.acted) expect.soft(ov(c, m.acted), `${where} overlaps the piece it asks to restack ${JSON.stringify(m.acted)}`).toBe(false);
  for (const o of m.outlines) {
    expect.soft(ov(c, o), `${where} overlaps an active outline ${JSON.stringify(o)}`).toBe(false);
    if (!opts.panned) expect.soft(inView(o), `${label}: the outline ${JSON.stringify(o)} is inside the viewport`).toBe(true); // a visitor's pan may take it out
  }
  if (m.turn) expect.soft(ov(c, m.turn), `${where} overlaps the piece being turned ${JSON.stringify(m.turn)}`).toBe(false);
  for (const h of m.handles) expect.soft(ov(c, h), `${where} overlaps a rotate handle's 44px hit box ${JSON.stringify(h)}`).toBe(false);
  // v1.6.3: the guide bar is a hard obstacle (never under the callout, an outline or a handle) and covers no control.
  if (m.bar) {
    const bar = m.bar;
    expect.soft(ov(c, bar), `${where} overlaps the guide bar ${JSON.stringify(bar)}`).toBe(false);
    if (!opts.panned) for (const o of m.outlines) expect.soft(ov(o, bar), `${label}: an outline ${JSON.stringify(o)} is under the guide bar`).toBe(false);
    for (const k of m.controls) expect.soft(ov(bar, k.r), `${label}: the guide bar overlaps ${k.name}`).toBe(false);
    expect.soft(ov(bar, m.tray), `${label}: the guide bar overlaps the tray`).toBe(false);
    expect.soft(inView(bar), `${label}: the guide bar is in the viewport`).toBe(true);
  }
  // v1.6.3: a callout may cover a control ONLY when it points at its target from close by, its arrow showing; and on
  // phones in portrait it never covers the top row (zoom group, menu button) at all.
  if (!opts.squeezed) {
    const t = m.slice;
    const reach = !t || m.side === 'centre' ? Infinity : m.side === 'above' ? t.y - (c.y + c.h) : m.side === 'below' ? c.y - (t.y + t.h) : m.side === 'right' ? c.x - (t.x + t.w) : t.x - (c.x + c.w);
    for (const k of m.controls) {
      if (!ov(c, k.r)) continue;
      expect.soft(!!t && m.side !== 'centre' && !m.noarrow && reach <= 31, `${where} covers ${k.name} without pointing at its target from close by (reach ${reach}, arrow ${m.noarrow ? 'hidden' : 'shown'})`).toBe(true);
      if (m.portrait) expect.soft(/\b(view|vmenu)\b/.test(k.name), `${where} covers the portrait top row (${k.name})`).toBe(false);
    }
  }
  // A centred callout (nothing to point at) keeps clear of every control; in the word the button block always stays clear.
  // (squeezed: a pan put the rotate handle where the callout was: handle and outlines come first, the block may be touched.)
  for (const k of m.controls) {
    const block = k.name.includes('block');
    if ((m.side === 'centre' || (block && m.phase === 'word')) && !(opts.squeezed && block)) expect.soft(ov(c, k.r), `${where} overlaps ${k.name} ${JSON.stringify(k.r)}`).toBe(false);
  }
  return m;
}

async function shoot(page: Page, project: string, name: string) {
  const n = NAMES[project];
  if (n) await page.screenshot({ path: `${SHOT}/g2-${name}-${n}.png` });
}

/** Step 4: the ovals cover the wedge; the callout points at Bring forward, the wedge selected. */
async function checkStep4(page: Page, label: string) {
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[4]);
  expect(await el(page, '[data-outline]').count(), 'no outline at step 4').toBe(0);
  await expect(el(page, '[data-block=x]')).toHaveAttribute('data-mode', 'delete');
  await expect(guide(page)).toHaveAttribute('data-target', 'action');
  await expect(guide(page)).toHaveAttribute('data-action', 'forward');
  const s = await state(page);
  const wedge = s.filled[s.outlines.findIndex((o) => o.shapeId === 'wedge')]!;
  expect(s.stack?.id).toBe(wedge);
  expect(s.stack?.dir).toBe('forward');
  expect(await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { selection: string[] }).selection), 'the wedge is selected').toEqual([wedge]);
  // It points at the block's Forward (the up arrow), which is on, and never covers it (nor Back beside it).
  await expect(el(page, '.block [data-block=forward]')).toBeEnabled();
  const geo = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const r = (e: Element) => e.getBoundingClientRect().toJSON() as DOMRect;
    const g = sr.querySelector('.guide')!, b = sr.querySelector('.block [data-block=backward]')!, f = sr.querySelector('.block [data-block=forward]')!;
    return { g: r(g), b: r(b), f: r(f), side: (g as HTMLElement).dataset.side, arrow: r(sr.querySelector('.gpt')!) };
  });
  const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(hit(geo.g, geo.f), `${label}: the callout never covers Forward`).toBe(false);
  if (geo.side === 'above' || geo.side === 'below') {
    const tip = geo.arrow.x + geo.arrow.width / 2;
    expect(tip >= geo.f.x - 1 && tip <= geo.f.x + geo.f.width + 1, `${label}: the arrow is level with Forward ${JSON.stringify(geo)}`).toBe(true);
  }
  await checkCallout(page, label);
  return wedge;
}

/** Step 4: press Bring forward (the block's Forward) as many times as it takes; step 5. Returns the presses. */
async function bringWedgeForward(page: Page, isMobile: boolean) {
  let n = 0;
  for (; n < 6 && (await state(page)).step === 4; n++) {
    const before = JSON.stringify(await pieces(page));
    await pressAction(page, isMobile, 'forward');
    await expect.poll(async () => JSON.stringify(await pieces(page))).not.toBe(before);
  }
  await expect.poll(async () => (await state(page)).step).toBe(5);
  return n;
}

/**
 * Step 1 (copy v4): the wedge from the tray, dropped close to its outline drawn at the angle it lands at (0): it clicks into
 * that position, unturned (1b: the outline now at its true angle, the turning hint); then turned in with the handle.
 */
async function wedgeIn(page: Page, isMobile: boolean, project?: string, shots?: string) {
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[1]);
  await dropNear(page, 2);
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? TURN_TOUCH : TURN);
  const s = await state(page);
  const wedge = s.turn!;
  const p = (await pieces(page)).find((q) => q.id === wedge)!;
  expect([p.x, p.y, p.rotation], 'clicked into the outline\'s position, its angle kept').toEqual([s.outlines[2].x, s.outlines[2].y, 0]);
  await landed(page);
  if (project) await checkCallout(page, 'step 1b');
  if (shots) await page.screenshot({ path: `${shots}-1b-turn.png` });
  await turnTo(page, wedge, s.outlines[2].rotation, 5); // 5 degrees past: still clicks in, exactly
  await expect.poll(async () => (await state(page)).step).toBe(2);
  return wedge;
}

/** Build the c (copy v4): the wedge (dropped at its landing angle, turned in), the black oval, the white oval, Bring forward. */
async function buildC(page: Page, isMobile: boolean, project?: string) {
  const wedge = await wedgeIn(page, isMobile, project);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[2]);
  if (project) {
    await checkCallout(page, 'step 2');
    await shoot(page, project, 'step2');
  }
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[3]);
  if (project) await checkCallout(page, 'step 3');
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(4);
  await checkStep4(page, 'step 4');
  if (project) await shoot(page, project, 'step4');
  await bringWedgeForward(page, isMobile);
  return wedge;
}

test('blank start (no intro), then the c with the stacking lesson (copy v4): the wedge at its landing angle, clicked into position, turned in; the black oval and the white oval cover it; Bring forward from the button block until it cuts in; undo keeps the guide in step', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page, '/?n=c');
  expect(await pieceCount(page), 'the toy starts on a blank board').toBe(0);
  expect(await page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('[data-pieces] > [data-piece-id]').length)).toBe(0);
  // Non-modal: it never takes focus on load. Its words go to the polite live region.
  expect(await page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide'))).toBe(false);
  await expect(el(page, '#ff-live')).toContainText(C_TEXT[1]);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[1]);
  // v1.6.3: the instruction steps' controls are in the guide bar; the callout shows only the instruction.
  await expect(calloutButtons(page)).toHaveCount(0);
  await expect(gbar(page)).toBeVisible();
  await expect(bbtn(page, 'exit')).toHaveAccessibleName('Exit guide');
  await expect(bbtn(page, 'next')).toBeVisible();
  // v1.6.1: the callout is black with white text; v1.6.3: the bar's buttons are transparent (white edge and text).
  const look = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const g = sr.querySelector('.guide')!;
    return { bg: getComputedStyle(g).backgroundColor, color: getComputedStyle(g).color, btn: getComputedStyle(sr.querySelector('.gbar [data-gbar=exit]')!).backgroundColor, arrow: sr.querySelector('.gpt path')!.getAttribute('fill') };
  });
  expect(look).toEqual({ bg: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)', btn: 'rgba(0, 0, 0, 0)', arrow: '#000' });
  // ONE outline: the wedge, blueprint blue, DOTTED (a negative shape), about 2.75 screen px, no filters, no pointer events,
  // drawn at the angle a piece from the tray lands at (0), at the true outline's position.
  const outline = () => page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const os = [...sr.querySelectorAll<SVGGElement>('[data-outline]')];
    const geom = os[0]?.querySelector('path, polygon');
    const layer = sr.querySelector('[data-outlines]')!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const zoom = (document.querySelector('fridge-face') as FF).getView().zoom;
    const tf = os[0]?.getAttribute('transform') ?? '';
    return {
      n: os.length, shape: os[0]?.dataset.shape, line: os[0]?.dataset.line, stroke: geom?.getAttribute('stroke'), dash: geom?.getAttribute('stroke-dasharray') ?? null,
      css: geom ? getComputedStyle(geom).strokeDasharray : '', px: Number(geom?.getAttribute('stroke-width')) * k * zoom, events: layer.getAttribute('pointer-events'),
      filters: sr.querySelectorAll('filter').length + [...sr.querySelectorAll('[data-pieces] *, [data-outlines] *')].filter((e) => getComputedStyle(e).filter !== 'none').length,
      at: tf.match(/^translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/)?.slice(1).map(Number) ?? [],
    };
  });
  const s0 = await state(page);
  const W = s0.outlines[2];
  expect(W.shapeId).toBe('wedge');
  const o1 = await outline();
  expect(o1).toMatchObject({ n: 1, shape: 'wedge', line: 'dotted', stroke: '#378ADD', events: 'none', filters: 0 });
  expect(o1.at, 'the landing outline: the true position, rotation 0').toEqual([W.x, W.y, 0]);
  expect(o1.dash, 'a negative shape: dotted').toBeTruthy();
  expect(o1.px).toBeGreaterThan(2.4);
  expect(o1.px).toBeLessThan(3.1);
  const m1 = await checkCallout(page, 'step 1');
  expect(m1.kind).toBe('tray');
  await expect(guide(page)).toHaveAttribute('data-shape', 'wedge');
  await shoot(page, info.project.name, 'step1');

  // The wedge from the tray (rotation 0), dropped close to its landing outline: it clicks into the POSITION, unturned, as
  // part of the drop (one undo step). The outline now shows the true angle and the callout asks for the turn.
  await dropNear(page, 2);
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  await expect(el(page, '#ff-live')).toContainText('Clicked into place.');
  let s = await state(page);
  let ps = await pieces(page);
  const wedge = s.turn!;
  expect(ps.map((p) => [p.shapeId, p.x, p.y, p.rotation])).toEqual([['wedge', W.x, W.y, 0]]);
  expect(s.step).toBe(1);
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? TURN_TOUCH : TURN);
  await landed(page);
  expect((await outline()).at, 'the outline at its TRUE angle now').toEqual([W.x, W.y, W.rotation]);
  await expect(guide(page)).toHaveAttribute('data-target', 'handle');
  await checkCallout(page, 'step 1b');
  await shoot(page, info.project.name, 'step1b');
  await press(isMobile, el(page, '[data-block=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo removes the drop AND its click-in').toBe(0);
  await expect.poll(async () => (await state(page)).turn).toBeNull();
  expect((await outline()).at, 'back to the landing outline').toEqual([W.x, W.y, 0]);
  // (v1.6.0: on phones the step 1a callout may sit over the button block, right by the tray: redo from the keyboard.)
  await historyKey(page, 'redo');
  await expect.poll(async () => (await state(page)).turn).toBe(wedge);
  // Turned with the handle, about its centroid: it reaches the true outline and clicks in exactly.
  await page.evaluate((id) => (document.querySelector('fridge-face') as unknown as { select(id: string): void }).select(id), wedge);
  await turnTo(page, wedge, W.rotation, 5);
  await expect.poll(async () => (await state(page)).step).toBe(2);
  ps = await pieces(page);
  expect(onOutline(ps[0], W), 'exactly on its outline').toBe(true);
  // Step 2: the black oval's outline, SOLID (a positive shape), the same weight.
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[2]);
  const o2 = await outline();
  expect(o2).toMatchObject({ n: 1, shape: 'positive-round', line: 'solid', stroke: '#378ADD', dash: null, css: 'none', filters: 0 });
  expect(o2.px).toBeCloseTo(o1.px, 1);
  await checkCallout(page, 'step 2');
  await shoot(page, info.project.name, 'step2');

  // The black oval lands ON TOP (a newly added piece): it covers the wedge. Nothing reorders it.
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[3]);
  expect((await outline()).shape).toBe('negative-round');
  await checkCallout(page, 'step 3');
  await shoot(page, info.project.name, 'step3');
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(4);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'no auto-reorder: the ovals on top, covering the wedge').toEqual(['wedge', 'positive-round', 'negative-round']);
  await checkStep4(page, 'step 4');
  await expect(el(page, '#ff-live')).toContainText(C_TEXT[4]);
  await shoot(page, info.project.name, 'step4');
  // Bring forward, from the button block the callout points at: the wedge passes each overlapping piece above it.
  const presses = await bringWedgeForward(page, isMobile);
  expect(presses, 'v1.6.2: it passes the black oval only (the white oval is white too): ONE press').toBe(1);
  await expect(el(page, '.guide .gt1')).toContainText("That's the letter 'c'.");
  await page.screenshot({ path: `${SHOTS}/v162-${info.project.name}-one-press.png` });
  s = await state(page);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'the wedge is above the black oval (the white oval and the wedge are both white: their order is free; one press leaves it below the white oval)').toEqual(['positive-round', 'wedge', 'negative-round']);
  inOutlineOrder(ps).forEach((p, i) => expect(onOutline(p, s.outlines[i]), `piece ${i} exactly on its outline`).toBe(true));
  expect(inOutlineOrder(ps)[2].rotation, 'the c inside word-create-1: its wedge at 101.22 degrees').toBeCloseTo(101.22, 2);
  expect(inOutlineOrder(ps)[1].x - inOutlineOrder(ps)[0].x).toBeCloseTo(-0.4, 6); // arranged exactly as in the word
  expect(inOutlineOrder(ps)[1].y - inOutlineOrder(ps)[0].y).toBeCloseTo(4.0, 6);
  // Undo the last press: step 4 again (the guide follows the board); redo: step 5.
  await historyKey(page, 'undo');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await historyKey(page, 'redo');
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  // Robust: a clicked-in piece moved away shows its outline again (step 2), and moving it back fills it again.
  const black = ps[0].id;
  await page.evaluate(({ id }) => {
    const ff = document.querySelector('fridge-face') as unknown as { composition: { movePiece(id: string, x: number, y: number): boolean } } & FF;
    const p = ff.composition.pieces.find((q) => q.id === id)!;
    ff.composition.movePiece(id, p.x + 900, p.y);
  }, { id: black });
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  expect(await el(page, '[data-outline]').count()).toBe(1);
  await historyKey(page, 'undo');
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(errors).toEqual([]);
});

test('copy v4 walk-through, guide ON: every c step (and Guide me) in screenshots; the callout sits by what it points at', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await open(page, '/?n=v4');
  const tag = `${SHOTS}/v161-${info.project.name}`;
  // How far the callout stands from its target (px between their edges), logged per step: it should hug it.
  const gapToTarget = async () => (await frames(page), await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const g = sr.querySelector<HTMLElement>('.guide')!;
    const r = g.getBoundingClientRect();
    const k = g.dataset.target;
    // The tray target is the shape's slice of the tray (its column across the tray; its row in the landscape column).
    const tb = sr.querySelector('.tray')!.getBoundingClientRect(), sb = sr.querySelector(`.tray button[data-shape="${g.dataset.shape}"]`)?.getBoundingClientRect();
    const slice = sb ? (tb.width >= tb.height ? new DOMRect(sb.x, tb.y, sb.width, tb.height) : new DOMRect(tb.x, sb.y, tb.width, sb.height)) : null;
    const t = k === 'tray' ? (slice ? { getBoundingClientRect: () => slice } : null) : k === 'handle' ? sr.querySelector('[data-handle] circle') : k === 'action' ? sr.querySelector(`.block [data-block=${g.dataset.action}]`) : null;
    if (!t) return null;
    const q = t.getBoundingClientRect();
    const dx = Math.max(0, q.left - r.right, r.left - q.right), dy = Math.max(0, q.top - r.bottom, r.top - q.bottom);
    return Math.round(Math.hypot(dx, dy));
  }));
  const gaps: Record<string, number | null> = {};
  gaps['1a'] = await gapToTarget();
  await checkCallout(page, 'v4 step 1a');
  await page.screenshot({ path: `${tag}-1a-drag-wedge.png` });
  await wedgeIn(page, isMobile, info.project.name, tag);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[2]);
  gaps['2'] = await gapToTarget();
  await checkCallout(page, 'v4 step 2');
  await page.screenshot({ path: `${tag}-2-black-oval.png` });
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  gaps['3'] = await gapToTarget();
  await checkCallout(page, 'v4 step 3');
  await page.screenshot({ path: `${tag}-3-white-oval.png` });
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(4);
  await checkStep4(page, 'v4 step 4');
  gaps['4'] = await gapToTarget();
  await page.screenshot({ path: `${tag}-4-bring-forward.png` });
  await bringWedgeForward(page, isMobile);
  await expect(el(page, '.guide .gt1')).toHaveText("That's the letter 'c'.");
  await page.screenshot({ path: `${tag}-5-thats-a-c.png` });
  if (await realCreate(page)) {
    await press(isMobile, gbtn(page, 'word'));
    await expect(guide(page)).toHaveAttribute('data-step', '6');
    await settled(page);
    await expect(el(page, '.gbar .gcount')).toHaveText('3 of 32');
    await page.screenshot({ path: `${tag}-6-guide-me.png` });
  }
  console.log(`[${info.project.name}] callout gap to its target, px: ${JSON.stringify(gaps)}`);
  for (const [k, v] of Object.entries(gaps)) expect.soft(v ?? 0, `step ${k}: the callout is close to its target`).toBeLessThan(80);
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
  // The first batch is one black oval; the second a black stem and a white oval: both styles.
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
  await expect.poll(async () => (await shown(page)).idx).toEqual(CREATE_BATCHES[2]);
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
  // v1.4.1: desktop behaves like phones, only the batch's outlines show (no faint preview of the rest of the word).
  expect(await contextShown(page), 'no faint context outlines on any layout').toEqual([]);
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g6-outline-styles-desktop.png` });
});

test('step 5 without word-create-1: step 5 and only Clear for free play, which clears as ONE undoable step and ends the guide', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page, '/?n=4');
  await dropCreate(page);
  await buildC(page, isMobile);
  await expect(guide(page)).toBeVisible();
  await expect(el(page, '.guide .gt1')).toHaveText("That's the letter 'c'.");
  await expect(el(page, '.guide .gt2'), 'no question without the word').toBeHidden();
  await expect(gbtn(page, 'word')).toBeHidden();
  await expect(gbtn(page, 'clear')).toBeVisible();
  await expect(gbtn(page, 'clear')).toHaveText('No, clear for free play');
  await expect(gbtn(page, 'skip')).toBeHidden();
  await expect(gbtn(page, 'off')).toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines on step 5').toBe(0);
  const m = await checkCallout(page, 'step 5 (no word)');
  expect(m.side).toBe('centre');
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g2-step4-noword-desktop.png` });
  await press(isMobile, gbtn(page, 'clear'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-block=undo]'));
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
  // Stacking among themselves (v1.6.2: only the black/white pairs matter; the white oval and the wedge may be either way round):
  // the black oval is below both white pieces.
  const at = (shape: string) => now.findIndex((q) => q.id === c.find((p) => p.shapeId === shape)!.id);
  expect(at('positive-round'), `${label}: the black oval below the white oval`).toBeLessThan(at('negative-round'));
  expect(at('positive-round'), `${label}: the black oval below the wedge`).toBeLessThan(at('wedge'));
}

/** Every outline of the word in the same board frame as the c: outlines 0, 1, 2 are exactly the c's pieces. */
async function expectWordOnC(page: Page, c: P[]) {
  const s = await state(page);
  expect(s.outlines.slice(0, 3).map((o, i) => onOutline(c[i], o)), 'the c\'s pieces sit exactly on their outlines').toEqual([true, true, true]);
  expect(s.filled.slice(0, 3), 'and count as filled').toEqual(c.map((p) => p.id));
  const shown = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => Number(g.dataset.outline)));
  expect(shown.filter((i) => i < 3), 'the c\'s outlines are not shown').toEqual([]);
}

test('the REAL word-create-1 (32 pieces), built in stacking order batch by batch (shuffled within each batch): never a stacking prompt, only the current batch shows, each batch framed, the final stacking order is the word\'s; step 7, Start fresh, one undo restores', async ({ page, isMobile }, info) => {
  test.setTimeout(400_000);
  const errors = collectErrors(page);
  await open(page, '/?n=w');
  const total = await realCreate(page);
  expect(total, 'Edward\'s create (flower)').toBe(32);
  await buildC(page, isMobile, info.project.name);
  await expect(el(page, '.guide .gt1')).toHaveText("That's the letter 'c'.");
  await expect(el(page, '.guide .gt2')).toHaveText('Do you want to continue the tutorial?');
  await expect(gbtn(page, 'word')).toHaveText('Yes, continue');
  await expect(gbtn(page, 'clear')).toHaveText('No, clear for free play');
  await checkCallout(page, 'step 5');
  await shoot(page, info.project.name, 'step5');
  const c = inOutlineOrder(await pieces(page));
  expect(c).toHaveLength(3);
  const view5 = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());

  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expectCInPlace(page, c, 'Guide me'); // nothing cleared, nothing moved
  await expectWordOnC(page, c);
  expect((await state(page)).batches, 'the plan of the real word (src/batches.test.ts)').toEqual(CREATE_BATCHES);
  await expect(el(page, '.guide .gt1')).toHaveText('Fill in the outlines to spell "create".');
  await expect(el(page, '.gbar .gcount')).toHaveText(`3 of ${total}`);
  await expect(el(page, '#ff-live')).toContainText(`3 of ${total}`);
  await expect(bbtn(page, 'exit')).toBeVisible();
  await expect(calloutButtons(page)).toHaveCount(0);
  await settled(page);
  if (!isMobile) {
    const v = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
    expect(v, 'desktop: the first batch is beside the c, already in view: the view does not move').toEqual(view5);
  }
  // Undo at the start of step 6: Guide me added no undo step, so it takes back the c's last action (copy v4: the wedge's
  // last Bring forward) and never the c itself; the guide stays on the word, which now prompts to restack the wedge and the
  // white oval it is under (the word's own prompt: either may be asked to move; batch 0, the c, is current again: no outline
  // shows). Redo: 3 of 32 again.
  await press(isMobile, el(page, '[data-block=undo]'));
  await expect.poll(async () => (await state(page)).stack).not.toBeNull();
  const und = await state(page);
  expect([und.filled[0], und.filled[2]], 'the black oval or the wedge (the wrong black/white pair)').toContain(und.stack!.id);
  expect(await pieceCount(page), 'the c is still on the board').toBe(3);
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect(el(page, '.gbar .gcount')).toHaveText(`1 of ${total}`);
  await expect(el(page, '.guide .gt3')).toHaveText(STACK_TEXT[und.stack!.dir]);
  await expect.poll(async () => (await shown(page)).idx, 'no outline: the c is current').toEqual([]);
  await press(isMobile, el(page, '[data-block=redo]'));
  await expect(el(page, '.gbar .gcount')).toHaveText(`3 of ${total}`);
  await expectCInPlace(page, c, 'undo and redo at the boundary');
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { select(id: string | null): void }).select(null));

  const nm = NAMES[info.project.name];
  const landscape = info.project.name.endsWith('landscape');
  const mins: string[] = [];
  let moves = 0, done = 3, seed = 7;
  // Batch 1 is compared with the view at step 5 (the undo and redo above already glide between batch 0 and batch 1, so the
  // view read here may or may not have reached batch 1's framing yet, depending on the machine's speed).
  let last = view5;
  for (let k = 1; k < CREATE_BATCHES.length; k++) {
    await settled(page);
    const batch = CREATE_BATCHES[k];
    const sh = await shown(page);
    expect(sh.idx, `batch ${k}: only its outlines show`).toEqual(batch);
    expect(await contextShown(page), `batch ${k}: no faint preview of the rest of the word`).toEqual([]);
    await expect(el(page, '.gbar .gcount')).toHaveText(`${done} of ${total}`);
    const f = await framing(page, batch);
    expect(f.inView, `batch ${k}: its outlines are in view, clear of the docks`).toBe(true);
    if (!isMobile) expect(f.zoom, `batch ${k}: never closer than the comfortable zoom`).toBeLessThanOrEqual(f.comfort + 1e-9);
    const moved = f.view.x !== last.x || f.view.y !== last.y || f.view.zoom !== last.zoom;
    if (moved) moves++;
    if (isMobile) expect(moved, `batch ${k}: phones frame each batch`).toBe(true);
    last = f.view;
    mins.push(sh.min.toFixed(1));
    if (isMobile) expect(sh.min, `batch ${k}: the thinnest target`).toBeGreaterThanOrEqual(landscape ? 13.9 : 17.9); // the global floors are 24 and 20; a batch that cannot fit the callout at them takes a lower one, down to 18 and 14
    await checkCallout(page, `batch ${k}`);
    if ((nm === 'desktop' || nm === 'wk-iphone') && (k === 1 || k === 3)) await page.screenshot({ path: `${SHOT}/g7-batch${k}-${nm}.png` });
    if (nm === 'wk-iphone-landscape' && k === 2) await page.screenshot({ path: `${SHOT}/g7-batch2-wk-iphone-landscape.png` });
    if (batch.join() === PETALS.join()) {
      // The petal batch: all five petal outlines at once (they overlap; their order does not matter).
      expect(sh.idx, 'all five petal outlines visible at once').toEqual(PETALS);
      console.log(`[${info.project.name}] petal batch: smallest target ${sh.min.toFixed(1)} CSS px`);
      info.annotations.push({ type: 'petal batch target', description: `${sh.min.toFixed(1)} CSS px` });
      if (isMobile) expect(sh.min, 'petal batch: the global floor (24 portrait / 20 landscape)').toBeGreaterThanOrEqual(landscape ? 20 : 24);
      if (nm === 'wk-iphone') await page.screenshot({ path: `${SHOT}/v150-petals-wk-iphone.png` });
    }
    // A shuffled order within the batch (fixed seed): any order is right.
    const order = [...batch];
    for (let j = order.length - 1; j > 0; j--) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = Math.floor((seed / 233280) * (j + 1));
      [order[j], order[r]] = [order[r], order[j]];
    }
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      if (n) await settled(page);
      const was = (await pieces(page)).map((p) => p.id);
      await fillByHand(page, i);
      if (n === 0 && k === 2) await checkCallout(page, `batch ${k}: after a click-in`);
      const s = await state(page);
      // No auto-reorder: the new piece is on top, everything else in the order it was; and nothing is ever mis-stacked.
      const now = (await pieces(page)).map((p) => p.id);
      expect(now.slice(0, -1), `outline ${i}: the stacking order is untouched by the click-in`).toEqual(was);
      expect(now.at(-1)).toBe(s.filled[i]);
      expect(s.stack, `outline ${i}: no stacking prompt`).toBeNull();
      await expect(guide(page)).not.toHaveAttribute('data-stack', '');
      expect((await misStacked(page)).bad, `after outline ${i}: no overlapping pair out of order`).toEqual([]);
      done++;
      if (done < total) await expect(el(page, '.gbar .gcount')).toHaveText(`${done} of ${total}`);
    }
  }
  info.annotations.push({ type: 'smallest target per batch', description: mins.join(', ') + ' CSS px' });
  console.log(`[${info.project.name}] smallest target per batch: ${mins.join(', ')} CSS px; the view moved for ${moves} of ${CREATE_BATCHES.length - 1} batches`);
  await expect(guide(page)).toHaveAttribute('data-step', '7');
  await expect(el(page, '.guide .gt1')).toHaveText("Great work! Now you're ready to create on your own.");
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
  await settled(page);
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
  await checkCallout(page, 'step 7');
  if (nm === 'desktop') await page.screenshot({ path: `${SHOT}/g7-done-desktop.png` });
  if (nm === 'wk-iphone') await page.screenshot({ path: `${SHOT}/g7-done-wk-iphone.png` });

  await press(isMobile, gbtn(page, 'fresh'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-block=undo]'));
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
  await expect(guide(page), 'still step 5').toHaveAttribute('data-step', '5');
  const c = inOutlineOrder(await pieces(page));
  const s4 = await state(page);
  c.forEach((p, i) => expect(onOutline(p, s4.outlines[i]), 'the c\'s outlines followed it').toBe(true));
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expectCInPlace(page, c, 'moved c, Guide me');
  await expectWordOnC(page, c);
  await expect(el(page, '.gbar .gcount')).toHaveText('3 of 32');
});

test('no click-in outside the guide: after Skip (and with no-guide) a piece dropped right by where the outline was stays where it was dropped', async ({ page, browser }, info) => {
  await open(page, '/?n=nosnap');
  const first = await activeOutline(page);
  const o = (await state(page)).outlines[first];
  expect(o.shapeId, 'copy v4: the wedge first').toBe('wedge');
  await dropNear(page, first);
  await expect.poll(async () => (await state(page)).turn, 'the guide clicked it into position').not.toBeNull();
  await press(!!info.project.use.isMobile, el(page, '[data-block=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await press(!!info.project.use.isMobile, bbtn(page, 'exit'));
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
  expect(Math.hypot(p.x - o.x, p.y - o.y), 'not pulled into the outline\'s position either').toBeGreaterThan(1);
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

test('Next in the guide bar (always offered on an instruction step) does the current thing for the visitor (fills the outline, or brings the wedge forward), one undoable step each; keyboard only', async ({ page }) => {
  await open(page);
  await expect(bbtn(page, 'next'), 'v1.6.3: no stuck delay').toBeVisible();
  for (const step of ['2', '3', '4', '5']) {
    await bbtn(page, 'next').focus();
    await page.keyboard.press('Enter');
    await expect(guide(page)).toHaveAttribute('data-step', step);
    if (step === '3') expect((await pieces(page)).map((p) => p.shapeId), 'Next placed the black oval on top').toEqual(['wedge', 'positive-round']);
    if (step === '4') expect((await pieces(page)).map((p) => p.shapeId), 'and the white oval').toEqual(['wedge', 'positive-round', 'negative-round']);
    if (step !== '5') await expect(bbtn(page, 'next')).toBeVisible();
  }
  const ps = await pieces(page);
  const s = await state(page);
  expect(ps.map((p) => p.shapeId), 'Next brought the wedge forward').toEqual(['positive-round', 'wedge', 'negative-round']);
  inOutlineOrder(ps).forEach((p, i) => expect(onOutline(p, s.outlines[i])).toBe(true));
  await expect(gbar(page), 'step 5 (a question) has no bar').toBeHidden();
  // A keyboard user who pressed Next into the question goes on to its buttons.
  await expect.poll(() => page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide') ? 'callout' : 'elsewhere')).toBe('callout');
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('Control+z');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await page.keyboard.press('Control+z');
  await expect(guide(page), 'undoing Next\'s white oval').toHaveAttribute('data-step', '3');
});

test('Exit guide ends it for this visit; it comes back (asking first) on the next one', async ({ page, isMobile }) => {
  await open(page);
  await press(isMobile, bbtn(page, 'exit'));
  await expect(gbar(page)).toBeHidden();
  await expect(guide(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  await page.waitForTimeout(500);
  await page.reload();
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
});

test("Don't show again survives a reload; Show guide in Controls replays it from step 1 without unsetting it", async ({ page, isMobile }) => {
  await openWelcome(page);
  await press(isMobile, gbtn(page, 'optout'));
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
  // A replay is asked for: focus moves into the guide (v1.6.3: the instruction step's controls are in the guide bar: Next).
  await expect.poll(() => page.evaluate(() => (document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null)?.dataset.gbar)).toBe('next');
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
  await expect(el(page, '[data-block=x]')).toHaveAttribute('data-mode', 'delete');
  await page.keyboard.press('l');
  await expect(el(page, '.sugg')).toBeVisible();
  await expect(guide(page), 'hidden while the sheet is open').toBeHidden();
  await page.keyboard.press('Escape');
  await expect(el(page, '.sugg')).toBeHidden();
  await expect(guide(page), 'back after').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  expect(await el(page, '[data-outline]').count()).toBe(0);
  await expect(el(page, '[data-block=x]'), 'the selection is still there').toHaveAttribute('data-mode', 'delete');
  await page.keyboard.press('Escape');
  await expect(el(page, '[data-block=x]')).toHaveAttribute('data-mode', 'clear');
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
  const tabbable = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('.guide button, .gbar button')].map((b) => b.tagName === 'BUTTON' && b.tabIndex === 0));
  expect(tabbable.every(Boolean)).toBe(true);
  // WebKit (like Safari by default) does not Tab to buttons at all; the walk is checked in Chromium.
  if (browserName === 'webkit') {
    await press(isMobile, bbtn(page, 'exit'));
    await expect(guide(page)).toBeHidden();
    return;
  }
  await el(page, '.board svg.surface').focus();
  let reached = '';
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const a = document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null;
      return a?.closest('.gbar') && a.dataset.gbar === 'exit' ? 'exit' : '';
    });
  }
  expect(reached, 'Tab reaches the guide bar\'s Exit').toBe('exit');
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
    if (!reduce) await expect.poll(() => p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('.gpt svg')!.getAnimations().length), 'the pointer nudges toward the target').toBeGreaterThan(0);
    const running = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('.gpt svg')!.getAnimations().length);
    if (reduce) expect(running, 'no pointer animation with reduced motion').toBe(0);
    else expect(running, 'the pointer nudges toward the target').toBeGreaterThan(0);
    await dropNear(p, await activeOutline(p), 0.12);
    await expect.poll(async () => (await state(p)).turn, 'the wedge clicked into position').not.toBeNull();
    const anims = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('[data-pieces] > [data-piece-id]')!.getAnimations().length);
    if (reduce) expect(anims, 'no settle with reduced motion').toBe(0);
    await ctx.close();
  }
});

test('axe: no violations with a callout showing (steps 1, 1b, 4, 5, 6 and a stacking prompt)', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  test.setTimeout(120_000);
  await open(page);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const run = () => page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(await run()).toEqual([]);
  await dropNear(page, 2);
  await expect(guide(page)).toHaveAttribute('data-turn', '');
  expect(await run(), 'step 1b').toEqual([]);
  await turnTo(page, (await state(page)).turn!, (await state(page)).outlines[2].rotation, 0);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await dropNear(page, await activeOutline(page));
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await dropNear(page, await activeOutline(page));
  await checkStep4(page, 'axe step 4');
  expect(await run(), 'step 4').toEqual([]);
  await bringWedgeForward(page, isMobile);
  expect(await run()).toEqual([]);
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await settled(page);
  expect(await run()).toEqual([]);
  // A stacking prompt (the safety net): the visitor brings a placed lower piece (the c's black oval) forward over its partner.
  expect(await selectPlacedLower(page)).not.toBeNull();
  await pressAction(page, isMobile, 'forward');
  await expect(guide(page)).toHaveAttribute('data-stack', '');
  await expect(guide(page)).toHaveAttribute('data-target', 'action');
  expect(await run(), 'a stacking prompt').toEqual([]);
});

test('storage that throws: the guide still shows, and "Don\'t show again" still ends it', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  });
  const errors = collectErrors(page);
  await openWelcome(page);
  await press(isMobile, gbtn(page, 'optout'));
  await expect(guide(page)).toBeHidden();
  expect(errors).toEqual([]);
  void process;
});

test('with a callout showing, the board still works around it: a wrong shape dropped on open board stays put; compact hit areas stay 44px', async ({ page }) => {
  await open(page);
  await checkCallout(page, 'step 1');
  const hits = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.gbar button')].map((b) => {
    const r = b.getBoundingClientRect();
    const a = getComputedStyle(b, '::after');
    const px = (v: string) => parseFloat(v) || 0;
    return { h: r.height - px(a.top) - px(a.bottom), w: r.width - px(a.left) - px(a.right) };
  }));
  expect(hits.length, 'the guide bar\'s three buttons').toBe(3);
  for (const h of hits) expect(h.h, 'hit area height').toBeGreaterThanOrEqual(44);
  // Open board: no callout, no control, no outline, with a margin.
  const spot = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const blocked = (x: number, y: number) => {
      const e = sr.elementFromPoint(x, y) as Element | null;
      return !e || !!e.closest('.guide, .gbar, .dock, .tray, .menu, [data-piece-id]');
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
  await expect(gbtn(page, 'skip')).toHaveText('Exit guide');
  await expect(gbtn(page, 'off')).toBeVisible();
  await expect(gbar(page), 'v1.6.3: no guide bar on a question step').toBeHidden();
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
  // Back through the c (one Bring forward, white oval, black oval, turn, wedge): the guide follows to step 1 on a blank board.
  // (v1.6.0: on phones the step 1 to 3 callouts may sit over the button block: undo from the keyboard.)
  for (let i = 0; i < 5; i++) await historyKey(page, 'undo');
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  // ONE more undo: every one of their pieces back, exactly (ids, places, rotations, stacking order).
  await historyKey(page, 'undo');
  await expect.poll(() => pieceCount(page)).toBe(theirs.length);
  expect(same(theirs, await pieces(page)), 'their pieces restored exactly').toBe(true);
  // Sane: still step 1, the c's outline moved beside their work (never on it), the callout well placed; redo clears again.
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).toBeVisible();
  await expectBeside(page, theirs);
  await checkCallout(page, 'after undoing Clear and start');
  await historyKey(page, 'redo');
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
  await press(isMobile, el(page, '[data-block=undo]'));
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
  const c = inOutlineOrder((await pieces(page)).filter((p) => !theirs.some((t) => t.id === p.id)));
  expect(c).toHaveLength(3);
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect.poll(() => pieceCount(page), 'nothing is cleared').toBe(theirs.length + 3);
  await expectCInPlace(page, c, 'keep, Guide me');
  await expectWordOnC(page, c);
  const left = await pieces(page);
  expect(same(theirs, left.filter((p) => theirs.some((t) => t.id === p.id))), 'their saved pieces unchanged').toBe(true);
  const total = await realCreate(page);
  await expect(el(page, '.gbar .gcount')).toHaveText(`3 of ${total}`);
  // The WHOLE word (every outline, the c's included) is clear of their pieces' bounds.
  const all = await state(page);
  const a = await boundsIn(page, theirs), w = await boundsIn(page, all.outlines);
  expect(a!.x < w!.x + w!.w && w!.x < a!.x + a!.w && a!.y < w!.y + w!.h && w!.y < a!.y + a!.h, `the word ${JSON.stringify(w)} never overlaps their work ${JSON.stringify(a)}`).toBe(false);
  await expectBeside(page, theirs);
  await settled(page); // the view glides to the first batch (if it is not in view)
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
    const i = Math.min(...s.outlines.map((_, j) => j).filter((j) => !s.filled[j] && s.batches!.find((b) => b.some((q) => !s.done[q]))!.includes(j)));
    await fillByHand(page, i);
    await answerPrompts(page, isMobile, `keep, outline ${i}`, false);
    await expect(el(page, '.gbar .gcount')).toHaveText(`${n + 1} of ${total}`);
  }
  // The rest by Next (the guide bar's): it places pieces and fixes their stacking.
  for (let k = 0; k < 4 * total && (await state(page)).step === 6; k++) {
    await expect(bbtn(page, 'next')).toBeVisible();
    await bbtn(page, 'next').click({ force: true });
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
  await press(isMobile, el(page, '[data-block=undo]'));
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

// ---- v1.4.0: the word in stacking order, one batch at a time (every layout) -------------------------------------

/** The REAL word-create-1's batches from the built c: the plan curated for it (src/guide-plans.ts; src/batches.test.ts checks the same plan). */
const CREATE_BATCHES = [
  [0, 1, 2], [3], [4, 5], [6], [7, 8], [9], [10, 11, 16], [12, 17, 18], [13, 19], [14], [15, 20, 22], [24], [21], [23],
  [25, 26, 27, 28, 29], [30, 31],
];
/** v1.5.0: the flower's five petals, order-free among themselves, come up as ONE batch; the white centre (30) after them. */
const PETALS = [25, 26, 27, 28, 29];

/** Wait until the view is still: no batch framing pending, no glide running. */
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

/** Faint context outlines (their indices): removed in v1.4.1, so always empty; kept to prove it. */
async function contextShown(page: Page) {
  return page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGGElement>('[data-context]')].map((g) => Number(g.dataset.context)).sort((a, b) => a - b));
}

/**
 * How a batch is framed: the view, the comfortable zoom, and whether every one of its outlines (real geometry on screen) is
 * inside the board and below the docks along its top (phones: the docks cover the top of the board).
 */
async function framing(page: Page, batch: number[]) {
  return page.evaluate((batch) => {
    const ff = document.querySelector('fridge-face') as unknown as FF & { comfortZoom(): number };
    const sr = ff.shadowRoot!;
    const b = sr.querySelector('.board')!.getBoundingClientRect();
    const docks = [...sr.querySelectorAll<HTMLElement>('.dock > .panel')].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
    const inside = batch.every((i) => {
      const g = sr.querySelector<SVGGElement>(`[data-outline="${i}"]`);
      if (!g) return true; // filled already (not drawn)
      // Its real geometry on screen (a rotated SVG element's own box overstates it).
      const geom = g.querySelector<SVGGeometryElement>('path, polygon')!;
      const ctm = geom.getScreenCTM()!;
      const len = geom.getTotalLength();
      const pts = Array.from({ length: 96 }, (_, n) => geom.getPointAtLength((len * n) / 96)).map((q) => new DOMPoint(q.x, q.y).matrixTransform(ctm));
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const r = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      const clear = docks.every((d) => r.right <= d.left || r.left >= d.right || r.bottom <= d.top || r.top >= d.bottom);
      return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && clear;
    });
    const view = ff.getView();
    return { view, zoom: view.zoom, comfort: ff.comfortZoom(), inView: inside };
  }, batch);
}

/** Into step 6 on a blank board: the c by Next (it is tested above), then Guide me. The c stays: returns its pieces. */
async function toWord(page: Page, isMobile: boolean, url = '/?n=batch'): Promise<P[]> {
  await open(page, url);
  await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as unknown as { guideNextFill(): void };
    for (let i = 0; i < 4; i++) ff.guideNextFill();
  });
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  const c = inOutlineOrder(await pieces(page));
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  expect(await pieceCount(page), 'the c stays').toBe(3);
  await expectCInPlace(page, c, 'Guide me');
  await expectWordOnC(page, c);
  await expect(el(page, '.gbar .gcount')).toHaveText('3 of 32');
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

const nextFill = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());

test('undo back across a batch boundary returns to that batch (and its framing); redo; Next places the current batch\'s next piece', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await toWord(page, isMobile, '/?n=batchundo');
  // Next (one undoable step each) always fills the CURRENT batch's lowest outline; it never needs to restack anything.
  for (const want of [...CREATE_BATCHES[1], ...CREATE_BATCHES[2]]) {
    await settled(page);
    await nextFill(page);
    await expect.poll(async () => (await state(page)).filled[want], `Next filled outline ${want}`).not.toBeNull();
    expect((await state(page)).stack, 'Next in stacking order: no prompt').toBeNull();
  }
  await settled(page);
  expect((await shown(page)).idx, 'batch 3 now').toEqual(CREATE_BATCHES[3]);
  const v3 = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
  await press(isMobile, el(page, '[data-block=undo]'));
  await settled(page);
  expect((await shown(page)).idx, 'back in batch 2, its last outline showing').toEqual([CREATE_BATCHES[2][1]]);
  await press(isMobile, el(page, '[data-block=undo]'));
  await press(isMobile, el(page, '[data-block=undo]'));
  await settled(page);
  expect((await shown(page)).idx, 'back in batch 1').toEqual(CREATE_BATCHES[1]);
  await expect(el(page, '.gbar .gcount')).toHaveText('3 of 32');
  const v1 = await page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
  if (isMobile) expect(v1.x !== v3.x || v1.y !== v3.y || v1.zoom !== v3.zoom, 'phones: the view went back to batch 1').toBe(true);
  expect((await framing(page, CREATE_BATCHES[1])).inView).toBe(true);
  await checkCallout(page, 'undone into batch 1');
  for (let n = 0; n < 3; n++) await press(isMobile, el(page, '[data-block=redo]'));
  await settled(page);
  expect((await shown(page)).idx).toEqual(CREATE_BATCHES[3]);
  await expect(el(page, '.gbar .gcount')).toHaveText('6 of 32');
});

test('the safety net: the visitor brings a placed lower piece forward out of order: the stacking prompt shows (at the button block), they fix it, and the batches carry on', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await toWord(page, isMobile, '/?n=safety');
  for (let k = 1; k <= 4; k++) for (const _ of CREATE_BATCHES[k]) await nextFill(page);
  await settled(page);
  expect((await shown(page)).idx).toEqual(CREATE_BATCHES[5]);
  expect((await state(page)).stack).toBeNull();
  // Select a placed piece with a placed partner above it that it overlaps, and Bring it forward from the button block.
  const lower = (await selectPlacedLower(page))!;
  expect(lower).not.toBeNull();
  await expect(el(page, '[data-block=x]')).toHaveAttribute('data-mode', 'delete');
  await pressAction(page, isMobile, 'forward');
  await expect.poll(async () => (await state(page)).stack, 'a stacking prompt').not.toBeNull();
  await settled(page);
  await expect(guide(page)).toHaveAttribute('data-stack', '');
  expect((await misStacked(page)).bad.length, 'out of order now').toBeGreaterThan(0);
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g7-safety-net-desktop.png` });
  const a = await answerPrompts(page, isMobile, 'safety net');
  expect(a.prompts, 'one prompt (the piece and the way to fix it)').toBeGreaterThan(0);
  expect((await state(page)).stack).toBeNull();
  expect((await misStacked(page)).bad, 'fixed: every overlapping pair in the word\'s order').toEqual([]);
  await settled(page);
  expect((await shown(page)).idx, 'back to the batch it was on').toEqual(CREATE_BATCHES[5]);
  await expect(el(page, '.gbar .gcount')).toHaveText(`${3 + CREATE_BATCHES.slice(1, 5).flat().length} of 32`);
  expect(errors).toEqual([]);
});

test('rotating or resizing mid-step keeps the batch and the progress (portrait, landscape, desktop and back)', async ({ page, isMobile }, info) => {
  test.skip(info.project.name.endsWith('landscape'), 'portrait and desktop start points cover both directions');
  test.setTimeout(120_000);
  const start = page.viewportSize()!;
  if (!isMobile) await page.setViewportSize({ width: 393, height: 760 }); // a phone-sized window: the compact layout
  await toWord(page, isMobile, '/?n=rotate');
  await settled(page);
  for (const _ of [...CREATE_BATCHES[1], CREATE_BATCHES[2][0]]) await nextFill(page);
  await settled(page);
  const progress = async () => (await state(page)).done.filter(Boolean).length;
  expect(await progress()).toBe(5);
  const rest2 = [CREATE_BATCHES[2][1]];
  const sizes = [
    { name: 'landscape', w: 852, h: 393, compact: true },
    { name: 'desktop', w: 1280, h: 800, compact: false },
    { name: 'portrait', w: 393, h: 760, compact: true },
  ];
  for (const z of sizes) {
    await page.setViewportSize({ width: z.w, height: z.h });
    await expect.poll(async () => page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('.root')?.hasAttribute('data-compact') ?? null)).toBe(z.compact);
    await settled(page);
    expect(await progress(), `${z.name}: progress kept`).toBe(5);
    await expect(el(page, '.gbar .gcount')).toHaveText('5 of 32');
    expect((await shown(page)).idx, `${z.name}: still batch 2's last outline`).toEqual(rest2);
    expect((await framing(page, rest2)).inView, `${z.name}: framed`).toBe(true);
    expect(await contextShown(page), `${z.name}: no context outlines`).toEqual([]);
    await checkCallout(page, `after switching to ${z.name}`);
  }
  await fillByHand(page, rest2[0]);
  await settled(page);
  expect((await shown(page)).idx).toEqual(CREATE_BATCHES[3]);
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
  await dropNear(page, 2); // the wedge, at its landing angle: it clicks into position (1b)
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  const wedge = (await state(page)).turn!;
  await handleProbe(page, 'step 1b, another piece selected', [a]);
  await page.evaluate((id) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    ff.setSelection([id]);
    ff.render();
  }, wedge);
  await checkCallout(page, 'step 1b, the wedge selected');
  await turnTo(page, wedge, (await state(page)).outlines[2].rotation, 3);
  await expect.poll(async () => (await state(page)).step).toBe(2);
  await handleProbe(page, 'step 2', [a]);
  const b = await addStem(page, 60);
  await handleProbe(page, 'step 2, a selection of two', [a, b]);
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  await handleProbe(page, 'step 3', [a]);
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(4);
  // Step 4 points at Bring forward with the wedge selected: its own handle is never covered.
  await checkStep4(page, 'step 4, the wedge selected');
  await handleProbe(page, 'step 4', [wedge], true); // panned: moving the wedge would take it off its outline
  await page.evaluate((id) => {
    const ff = document.querySelector('fridge-face') as unknown as FFi;
    ff.setSelection([id]);
    ff.render();
  }, wedge);
  await bringWedgeForward(page, isMobile);
  await handleProbe(page, 'step 5', [a, b]);
  if (await realCreate(page)) {
    // The visitor's two stems were moved under the callout at the c's close-up (scale-dependent board spots, now beside the c).
    // They are not part of what this probe tests: take them off before Guide me (stray pieces would make it place the word
    // clear of them, not on the c), and use a fresh one for step 6.
    await page.evaluate((ids) => (document.querySelector('fridge-face') as unknown as { composition: { deletePieces(ids: string[]): number } }).composition.deletePieces(ids), [a, b]);
    await press(isMobile, gbtn(page, 'word'));
    await expect(guide(page)).toHaveAttribute('data-step', '6');
    await settled(page); // the view glides to the first batch
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
  // Copy v4: the wedge first. Half a turn round it does not fit (and is nowhere near its landing angle): it needs turning (1b).
  const wedge = await release('wedge', 2, 180);
  expect(wedge.after.rotation, 'the wedge did not click in').toBeCloseTo(wedge.before, 6);
  expect([wedge.after.x, wedge.after.y], 'nor was it moved').not.toEqual([wedge.outline.x, wedge.outline.y]);
  await expect.poll(async () => (await state(page)).turn, 'it needs turning (1b)').toBe(wedge.id);
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
  await expect.poll(async () => (await state(page)).step).toBe(2);
  const black = await release('positive-round', 0, -180 - 4);
  expect([black.after.x, black.after.y], 'exactly in place').toEqual([black.outline.x, black.outline.y]);
  expect(gap(black.after.rotation, black.before), 'turned only the 4 degrees it was off, not half a turn').toBeCloseTo(4, 6);
  expect(gap(black.after.rotation, black.outline.rotation), 'half a turn from the outline: the same oval').toBeCloseTo(180, 6);
  await expect.poll(async () => (await state(page)).step, 'the black oval counts as filled').toBe(3);
  const white = await release('negative-round', 1, 180 + 6);
  expect(gap(white.after.rotation, white.before)).toBeCloseTo(6, 6);
  await expect.poll(async () => (await state(page)).step, 'on top of the wedge: bring it forward').toBe(4);
  expect(errors).toEqual([]);
});

/** v1.6.1: on narrow phones every visible callout button label keeps >= 6px clear inside its border, and the callout stays on screen. */
for (const [w, h] of [[375, 812], [320, 568]] as const) {
  test(`v1.6.1: callout button labels clear their borders at ${w}x${h}; step shots`, async ({ page, isMobile }, info) => {
    test.skip(!isMobile || info.project.name.includes('landscape'), 'phone portrait only');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: w, height: h });
    await open(page, '/?n=v161');
    const tag = `${SHOTS}/v161-${w}x${h}-${info.project.name}`;
    const clear = async (label: string) => {
      await settled(page);
      const r = await page.evaluate(() => {
        const sr = document.querySelector('fridge-face')!.shadowRoot!;
        const g = sr.querySelector<HTMLElement>('.guide')!, gr = g.getBoundingClientRect();
        const out: { name: string; l: number; r: number }[] = [];
        for (const b of sr.querySelectorAll<HTMLElement>('.guide button.b')) {
          if (!b.getClientRects().length) continue;
          const cs = getComputedStyle(b), bw = parseFloat(cs.borderLeftWidth);
          const rg = document.createRange(); rg.selectNodeContents(b.querySelector('.tx')!);
          const t = rg.getBoundingClientRect(), br = b.getBoundingClientRect();
          out.push({ name: b.dataset.guide || '', l: t.left - br.left - bw, r: br.right - bw - t.right });
        }
        return { out, inside: gr.left >= 0 && gr.top >= 0 && gr.right <= innerWidth && gr.bottom <= innerHeight };
      });
      expect(r.inside, `${label}: callout on screen`).toBe(true);
      for (const b of r.out) { expect.soft(b.l, `${label} ${b.name} left`).toBeGreaterThanOrEqual(6); expect.soft(b.r, `${label} ${b.name} right`).toBeGreaterThanOrEqual(6); }
    };
    await clear('1a');
    await page.screenshot({ path: `${tag}-1a-drag-wedge.png` });
    if (w === 320) return;
    await wedgeIn(page, isMobile, undefined, tag);
    await clear('1b');
    await dropNear(page, await activeOutline(page));
    await dropNear(page, await activeOutline(page));
    await expect.poll(async () => (await state(page)).step).toBe(4);
    await clear('4');
    await page.screenshot({ path: `${tag}-4-bring-forward.png` });
    await bringWedgeForward(page, isMobile);
    await expect(el(page, '.guide .gt1')).toHaveText("That's the letter 'c'.");
    await clear('5');
    await page.screenshot({ path: `${tag}-5-thats-a-c.png` });
  });
}

test('step 0 on a blank board (v1.6.1): "Would you like a tutorial?" with Yes, No and Don\'t show again; Yes starts step 1, centred and clear of the controls', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await openWelcome(page);
  await expect(el(page, '.guide .gt1')).toHaveText('Would you like a tutorial?');
  await expect(gbtn(page, 'yes')).toHaveText('Yes');
  await expect(gbtn(page, 'no')).toHaveText('No');
  await expect(gbtn(page, 'optout')).toHaveText("Don't show again");
  for (const b of ['skip', 'off', 'clean', 'mine', 'word']) await expect(gbtn(page, b)).toBeHidden();
  await expect(gbar(page), 'no guide bar on the question').toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines at step 0').toBe(0);
  await expect(el(page, '#ff-live')).toContainText('Would you like a tutorial?');
  const m = await checkCallout(page, 'welcome');
  expect(m.side).toBe('centre');
  await page.screenshot({ path: `${SHOTS}/v161-welcome-${info.project.name}.png` });
  // Undo and redo with the question showing change nothing (and never start the guide).
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(guide(page)).toHaveAttribute('data-welcome', '');
  await press(isMobile, gbtn(page, 'yes'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).not.toHaveAttribute('data-welcome', '');
  expect(await el(page, '[data-outline]').count()).toBe(1);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[1]);
  await expect(calloutButtons(page), 'v1.6.3: the instruction alone').toHaveCount(0);
  await expect(bbtn(page, 'exit')).toBeVisible();
  expect(errors).toEqual([]);
});

test('step 0 on a blank board: No closes it for this visit and it asks again next visit; storage stays empty', async ({ page, isMobile }) => {
  await openWelcome(page);
  await press(isMobile, gbtn(page, 'no'));
  await expect(guide(page)).toBeHidden();
  expect(await stored(page)).toBeNull();
  await page.waitForTimeout(500);
  await page.reload();
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
});

test('Show guide (replay) on a blank board skips the welcome question and starts step 1', async ({ page, isMobile }) => {
  await openWelcome(page);
  await press(isMobile, gbtn(page, 'no'));
  await expect(guide(page)).toBeHidden();
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { replayGuide(): void }).replayGuide());
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(guide(page)).not.toHaveAttribute('data-welcome', '');
});

test('step 0 on a blank board: pieces loaded while the question shows turn it into "Start on a clean fridge?"', async ({ page }) => {
  await openWelcome(page);
  await page.evaluate(() => (document.querySelector('fridge-face') as FF).loadComposition({ v: 1, pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }] }));
  await expect.poll(() => pieceCount(page)).toBe(1);
  await expect(guide(page)).toHaveAttribute('data-ask', '');
  await expect(guide(page)).not.toHaveAttribute('data-welcome', '');
  await expect(el(page, '.guide .gt1')).toHaveText('Start on a clean fridge?');
});

// ---- v1.6.6: a piece placed correctly is deselected --------------------------------------------------------------------

const selectionOf = (page: Page) => page.evaluate(() => [...(document.querySelector('fridge-face') as unknown as { selection: string[] }).selection]);
const V166 = process.env.FF_SHOTS166 || SHOT;

test('v1.6.6: a piece that fits its outline is deselected (wedge after turning, black oval, white oval, a word piece, Next); the wedge stays selected at 1b; step 4 selects the wedge and one Forward press leaves nothing selected; undo is untouched', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  await open(page, '/?n=desel');
  // 1a -> 1b: in position but not turned: still selected (its handle and pulse show).
  await dropNear(page, 2);
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  let s = await state(page);
  const wedge = s.turn!;
  expect(await selectionOf(page), 'the wedge stays selected at 1b').toEqual([wedge]);
  await expect(el(page, '[data-handle]').first()).toBeAttached();
  await landed(page);
  // Turned in: placed correctly, nothing selected, no box and no handle.
  await turnTo(page, wedge, s.outlines[2].rotation, 5);
  await expect.poll(async () => (await state(page)).step).toBe(2);
  expect(await selectionOf(page), 'wedge placed: nothing selected').toEqual([]);
  expect(await el(page, '[data-selection-box]').count()).toBe(0);
  expect(await el(page, '[data-handle]').count()).toBe(0);
  await landed(page);
  await frames(page);
  await page.screenshot({ path: `${V166}/v166-${info.project.name}-step2.png` });
  // Black oval.
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(3);
  expect(await selectionOf(page), 'black oval placed: nothing selected').toEqual([]);
  expect(await el(page, '[data-selection-box]').count()).toBe(0);
  await landed(page);
  await frames(page);
  await page.screenshot({ path: `${V166}/v166-${info.project.name}-step3.png` });
  // White oval -> step 4: the wedge is selected on purpose.
  await dropNear(page, await activeOutline(page));
  await expect.poll(async () => (await state(page)).step).toBe(4);
  expect(await selectionOf(page), 'step 4 selects the wedge').toEqual([wedge]);
  // Undo / redo are not polluted by selection: undo the white oval (step 3), redo (step 4).
  await historyKey(page, 'undo');
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await historyKey(page, 'redo');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await checkStep4(page, 'step 4 (v1.6.6)');
  // ONE Forward press answers it; step 5, nothing selected.
  expect(await bringWedgeForward(page, isMobile), 'one press').toBe(1);
  expect(await selectionOf(page), 'stacking answered: nothing selected').toEqual([]);
});

test('v1.6.6: Next (fill, and the stacking Bring forward) leaves nothing selected; a word batch piece placed by hand is deselected; free play keeps the dropped piece selected', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await open(page, '/?n=desel2');
  for (let i = 0; i < 3; i++) {
    await nextFill(page);
    expect(await selectionOf(page), `Next filled outline ${i}: nothing selected`).toEqual(i === 2 ? [(await state(page)).stack!.id] : []);
  }
  expect((await state(page)).step).toBe(4);
  await nextFill(page); // brings the wedge forward
  await expect.poll(async () => (await state(page)).step).toBe(5);
  expect(await selectionOf(page), 'Next answered the stacking step: nothing selected').toEqual([]);
  // The word: a batch piece dropped by hand and turned in is deselected.
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  const first = (await state(page)).batches![1][0];
  await settled(page);
  await fillByHand(page, first);
  expect(await selectionOf(page), 'word piece placed: nothing selected').toEqual([]);
  // Outside the guide nothing changes: after Exit, a dropped piece is selected.
  await press(isMobile, bbtn(page, 'exit'));
  await expect(guide(page)).toBeHidden();
  const n = await pieceCount(page);
  const t = await el(page, '.tray button[data-shape="positive-stem"]').boundingBox();
  const b = await el(page, '.board').boundingBox();
  await drag(page, { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 }, { x: b!.x + b!.width * 0.5, y: b!.y + b!.height * 0.6 });
  await expect.poll(() => pieceCount(page)).toBe(n + 1);
  expect((await selectionOf(page)).length, 'free play: the dropped piece is selected').toBe(1);
});
