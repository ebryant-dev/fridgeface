import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * The onboarding guide v2 (v1.2.0), in Chromium AND WebKit, desktop, iPhone portrait and iPhone landscape: a blank board,
 * the c built piece by piece onto dotted outlines that pieces click into (guide only), step 4's choice, the whole word
 * "create" from a FIXTURE word-create-1 (added to the live store at runtime: nothing is written to src/suggestions/),
 * Skip / Don't show again / Next, replay from Controls, no-guide, share links, Escape order, coexistence with the menu,
 * sheet and dialog, placement in every layout, reduced motion and axe.
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
  guide: { step: number; outlines: O[]; filled: (string | null)[]; turn: string | null };
};

const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = { 'chromium-desktop': 'desktop', 'webkit-iphone': 'wk-iphone', 'webkit-iphone-landscape': 'wk-iphone-landscape' };
const C_TEXT = { 1: 'Drag the black oval onto the fridge.', 2: 'Now drag the white oval onto the black one.', 3: 'Drag the wedge into place.' };
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
  return { step: g.step, filled: [...g.filled], turn: g.turn, outlines: g.outlines.map((o) => ({ ...o })) };
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

/** The FIXTURE word-create-1: the c, r, a, t and e letter suggestions laid out tight, put into the live store (not a file). */
async function addCreate(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const load = (u: string) => import(/* @vite-ignore */ u);
    const { suggestionStore } = await load('/src/suggestion-store.ts');
    const sg = await load('/src/suggestions.ts');
    const { SHAPES } = await load('/src/shapes.ts');
    const shapeOf = (id: string) => SHAPES.find((s: { id: string }) => s.id === id);
    const get = (c: string) => suggestionStore.list.find((s: { char?: string; variant: number }) => s.char === c && s.variant === 1).pieces;
    const { pieces } = sg.layoutWord([...'create'].map(get), shapeOf, 20);
    const r = sg.validateSuggestion(sg.toWordFile('create', 1, sg.normaliseForSave(pieces, shapeOf)), 'word-create-1.json');
    if (!r.ok) throw new Error(r.error);
    suggestionStore.set(r.value);
    return r.value.pieces.length as number;
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

/**
 * The callout: inside the viewport and the board, clear of its target, the dock panels, the action bar and the tray, and
 * (v2) clear of every active outline and of the piece being turned toward one.
 */
async function checkCallout(page: Page, label: string) {
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
    const controls = [...sr.querySelectorAll<HTMLElement>('.dock > .panel, .actions')].filter(shown).map((e) => ({ name: e.className, r: rect(e) }));
    const outlines = [...sr.querySelectorAll('[data-outline]')].map(rect);
    const turn = ff.guide.turn ? sr.querySelector(`[data-piece-id="${ff.guide.turn}"] .bd`) : null;
    const arrow = sr.querySelector('.gpt')!;
    return {
      kind, side: g.dataset.side, callout: rect(g), arrow: g.dataset.side === 'centre' ? null : rect(arrow), target, controls, outlines,
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
    expect.soft(inView(o), `${label}: the outline ${JSON.stringify(o)} is inside the viewport`).toBe(true);
  }
  if (m.turn) expect.soft(ov(c, m.turn), `${where} overlaps the piece being turned ${JSON.stringify(m.turn)}`).toBe(false);
  expect.soft(ov(c, m.tray), `${where} overlaps the tray`).toBe(false);
  for (const k of m.controls) expect.soft(ov(c, k.r), `${where} overlaps ${k.name} ${JSON.stringify(k.r)}`).toBe(false);
  return m;
}

async function shoot(page: Page, project: string, name: string) {
  const n = NAMES[project];
  if (n) await page.screenshot({ path: `${SHOT}/g2-${name}-${n}.png` });
}

/** Build the c: black oval, white oval, then the wedge dropped near (3a -> 3b) and turned until it clicks in. */
async function buildC(page: Page, isMobile: boolean, project?: string, from = 1) {
  if (from === 1) await dropNear(page, 0);
  await expect.poll(async () => (await state(page)).step).toBe(2);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[2]);
  if (project) {
    await checkCallout(page, 'step 2');
    await shoot(page, project, 'step2');
  }
  await dropNear(page, 1);
  await expect.poll(async () => (await state(page)).step).toBe(3);
  await expect(el(page, '.guide .gt1')).toHaveText(C_TEXT[3]);
  if (project) await checkCallout(page, 'step 3a');
  await dropNear(page, 2); // at rotation 0: close in position, 111 degrees off
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? TURN_TOUCH : TURN);
  const wedge = (await state(page)).turn!;
  if (project) {
    await checkCallout(page, 'step 3b');
    await shoot(page, project, 'step3b');
  }
  await turnTo(page, wedge, 111.03, 5); // 5 degrees past: still clicks in, exactly
  await expect.poll(async () => (await state(page)).step).toBe(4);
  return wedge;
}

test('blank start (no intro), then the whole c: each piece clicks exactly into its one outline; 3a -> 3b; undo keeps the guide in step', async ({ page, isMobile }, info) => {
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
  // ONE outline: the black oval, blueprint blue, dotted, about 2.75 screen px, no filters, no pointer events.
  const o1 = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const os = [...sr.querySelectorAll<SVGGElement>('[data-outline]')];
    const geom = os[0]?.querySelector('path, polygon');
    const layer = sr.querySelector('[data-outlines]')!;
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const zoom = (document.querySelector('fridge-face') as FF).getView().zoom;
    return {
      n: os.length, shape: os[0]?.dataset.shape, stroke: geom?.getAttribute('stroke'), dash: geom?.getAttribute('stroke-dasharray'),
      px: Number(geom?.getAttribute('stroke-width')) * k * zoom, events: layer.getAttribute('pointer-events'),
      filters: sr.querySelectorAll('filter').length + [...sr.querySelectorAll('[data-pieces] *, [data-outlines] *')].filter((e) => getComputedStyle(e).filter !== 'none').length,
    };
  });
  expect(o1).toMatchObject({ n: 1, shape: 'positive-round', stroke: '#378ADD', events: 'none', filters: 0 });
  expect(o1.dash).toBeTruthy();
  expect(o1.px).toBeGreaterThan(2.4);
  expect(o1.px).toBeLessThan(3.1);
  const m1 = await checkCallout(page, 'step 1');
  expect(m1.kind).toBe('tray');
  await shoot(page, info.project.name, 'step1');

  // The black oval, dropped close: it clicks EXACTLY into place, as part of the drop (one undo step).
  await dropNear(page, 0);
  await expect.poll(async () => (await state(page)).step).toBe(2);
  let s = await state(page);
  let ps = await pieces(page);
  expect(ps).toHaveLength(1);
  expect(onOutline(ps[0], s.outlines[0]), 'exactly on its outline').toBe(true);
  await expect(el(page, '#ff-live')).toContainText('Clicked into place.');
  expect(await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => g.dataset.shape))).toEqual(['negative-round']);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo removes the drop AND its click-in').toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '2');

  const wedge = await buildC(page, isMobile, info.project.name, 2);
  s = await state(page);
  ps = await pieces(page);
  expect(ps.map((p) => p.shapeId), 'stacking order of lower-c-1').toEqual(['positive-round', 'negative-round', 'wedge']);
  ps.forEach((p, i) => expect(onOutline(p, s.outlines[i]), `piece ${i} exactly on its outline`).toBe(true));
  expect(ps[2].rotation).toBeCloseTo(111.03, 2);
  // Undo the turn: the wedge goes back (unturned, close) and the guide follows: 3b again. Redo: step 4.
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(async () => (await state(page)).turn).toBe(wedge);
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  // Robust: a clicked-in piece moved away shows its outline again (step 2), and moving it back fills it again.
  const white = (await pieces(page))[1];
  await page.evaluate(({ id }) => {
    const ff = document.querySelector('fridge-face') as unknown as { composition: { movePiece(id: string, x: number, y: number): boolean } } & FF;
    const p = ff.composition.pieces.find((q) => q.id === id)!;
    ff.composition.movePiece(id, p.x + 900, p.y);
  }, white);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  expect(await el(page, '[data-outline]').count()).toBe(1);
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  expect(errors).toEqual([]);
});

test('step 4 without word-create-1: "That\'s a c." and only Clear for free play, which clears as ONE undoable step and ends the guide', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page, '/?n=4');
  await buildC(page, isMobile);
  await expect(guide(page)).toBeVisible();
  await expect(el(page, '.guide .gt1')).toHaveText("That's a c.");
  await expect(el(page, '.guide .gt2'), 'no question without the word').toBeHidden();
  await expect(gbtn(page, 'word')).toBeHidden();
  await expect(gbtn(page, 'clear')).toBeVisible();
  await expect(gbtn(page, 'clear')).toHaveText('Clear for free play');
  await expect(gbtn(page, 'skip')).toBeHidden();
  await expect(gbtn(page, 'off')).toBeHidden();
  expect(await el(page, '[data-outline]').count(), 'no outlines on step 4').toBe(0);
  const m = await checkCallout(page, 'step 4 (no word)');
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

test('with a FIXTURE word-create-1: Guide me, fill every outline in a shuffled order (stacking order fixed), step 6, Start fresh, one undo restores', async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await open(page, '/?n=w');
  const total = await addCreate(page);
  await buildC(page, isMobile);
  await expect(el(page, '.guide .gt1')).toHaveText("That's a c.");
  await expect(el(page, '.guide .gt2')).toHaveText('Want to spell "create" next?');
  await expect(gbtn(page, 'word')).toHaveText('Guide me');
  await expect(gbtn(page, 'clear')).toHaveText('Clear for free play');
  await checkCallout(page, 'step 4');
  await shoot(page, info.project.name, 'step4');

  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await expect.poll(() => pieceCount(page), 'the c is cleared').toBe(0);
  await expect(el(page, '.guide .gt1')).toHaveText('Fill in the outlines to spell "create".');
  await expect(el(page, '.guide .gt2')).toHaveText(`0 of ${total}`);
  await expect(gbtn(page, 'skip')).toBeVisible();
  await expect(gbtn(page, 'off')).toBeVisible();
  expect(await el(page, '[data-outline]').count(), 'the whole word at once').toBe(total);
  await checkCallout(page, 'step 5');
  // Undo brings the c back but never goes back past Guide me.
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(3);
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await press(isMobile, el(page, '[data-history=redo]'));
  await expect.poll(() => pieceCount(page)).toBe(0);

  // A shuffled order (fixed seed), so negatives are often placed before the positives they cut.
  const order = Array.from({ length: total }, (_, i) => i);
  let seed = 7;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const before = await pieceCount(page);
    await dropNear(page, i);
    await expect.poll(() => pieceCount(page)).toBe(before + 1);
    let s = await state(page);
    if (!s.filled[i]) {
      // Close but mis-angled: the turning hint shows, then the handle turns it in.
      expect(s.turn, `outline ${i} needs turning`).not.toBeNull();
      await expect(el(page, '.guide .gt3')).toHaveText(isMobile ? TURN_TOUCH : TURN);
      if (n === 3) await checkCallout(page, 'step 5 turning');
      await turnTo(page, s.turn!, s.outlines[i].rotation, -4);
      await expect.poll(async () => (await state(page)).filled[i], `outline ${i} filled`).not.toBeNull();
      s = await state(page);
    }
    if (s.step === 5) await expect(el(page, '.guide .gt2')).toHaveText(`${n + 1} of ${total}`);
    if (n === 6) {
      await checkCallout(page, 'step 5 partly filled');
      await shoot(page, info.project.name, 'step5');
      if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g2-step5-desktop.png` });
      expect(await el(page, '[data-outline]').count(), 'filled outlines disappear').toBe(total - 7);
    }
  }
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect(el(page, '.guide .gt1')).toHaveText('You made "create". Now try your own name.');
  await expect(gbtn(page, 'fresh')).toHaveText('Start fresh');
  await expect(gbtn(page, 'keep')).toHaveText('Keep it');
  // The stacking order is exactly word-create-1's.
  const s = await state(page);
  const ps = await pieces(page);
  expect(ps.map((p) => s.outlines.findIndex((o) => onOutline(p, o))), 'every piece on its outline, in the word\'s stacking order').toEqual(s.outlines.map((_, i) => i));
  await checkCallout(page, 'step 6');
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/g2-step6-desktop.png` });

  await press(isMobile, gbtn(page, 'fresh'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page), 'one undo restores the whole word').toBe(total);
  expect((await pieces(page)).map((p) => s.outlines.findIndex((o) => onOutline(p, o)))).toEqual(s.outlines.map((_, i) => i));
  expect(errors).toEqual([]);
});

test('no click-in outside the guide: after Skip (and with no-guide) a piece dropped right by where the outline was stays where it was dropped', async ({ page, browser }, info) => {
  await open(page, '/?n=nosnap');
  const o = (await state(page)).outlines[0];
  await dropNear(page, 0);
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
  const t = await el(page, '.tray button[data-shape="positive-round"]').boundingBox();
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

test('Next (after waiting, shortened timer) fills the outline for the visitor, one undoable step each; keyboard only', async ({ page }) => {
  await open(page);
  await setNextMs(page, 200);
  await expect(gbtn(page, 'next')).toBeHidden(); // step 1's timer is the real 10 s one
  // Restart step 1 with the short timer: Controls -> Show guide is the replay; here Skip + Show guide via the API path.
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { replayGuide(): void }).replayGuide());
  await expect(gbtn(page, 'next')).toBeVisible();
  for (const step of ['2', '3', '4']) {
    await gbtn(page, 'next').focus();
    await page.keyboard.press('Enter');
    await expect(guide(page)).toHaveAttribute('data-step', step);
    if (step !== '4') await expect(gbtn(page, 'next')).toBeVisible();
  }
  const ps = await pieces(page);
  const s = await state(page);
  expect(ps.map((p) => p.shapeId)).toEqual(['positive-round', 'negative-round', 'wedge']);
  ps.forEach((p, i) => expect(onOutline(p, s.outlines[i])).toBe(true));
  await expect(gbtn(page, 'next'), 'step 4 has no Next').toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(guide(page)).toHaveAttribute('data-step', '3');
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

test('a share-link visit still shows the guide; the loaded pieces fill nothing and the c outline is centred in view', async ({ page, browser }, info) => {
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
  await expect(guide(p)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(p)).toBeVisible();
  await p.waitForTimeout(300);
  await expect(guide(p), 'the loaded pieces did not complete step 1').toHaveAttribute('data-step', '1');
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
    await dropNear(p, 0, 0.12);
    await expect.poll(async () => (await state(p)).step).toBe(2);
    const anims = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('[data-pieces] > [data-piece-id]')!.getAnimations().length);
    if (reduce) expect(anims, 'no settle with reduced motion').toBe(0);
    await ctx.close();
  }
});

test('axe: no violations with a callout showing (steps 1, 3b, 4 and 5)', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await open(page);
  await addCreate(page);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const run = () => page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(await run()).toEqual([]);
  await dropNear(page, 0);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await dropNear(page, 1);
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await dropNear(page, 2);
  await expect(guide(page)).toHaveAttribute('data-turn', '');
  expect(await run()).toEqual([]);
  await turnTo(page, (await state(page)).turn!, 111.03, 0);
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  expect(await run()).toEqual([]);
  await press(isMobile, gbtn(page, 'word'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(await run()).toEqual([]);
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
