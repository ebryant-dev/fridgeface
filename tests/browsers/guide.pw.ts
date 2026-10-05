import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * The onboarding guide (v1.1.0), in Chromium AND WebKit, desktop, iPhone portrait and iPhone landscape: learn-by-doing
 * callouts on the real UI, every visit, Skip / Don't show again / Next, replay from Controls, no-guide, share links,
 * Escape order, coexistence with the menu, sheet and dialog, placement in every layout, reduced motion and axe.
 */

// The other suites run with the guide turned off (playwright.config.ts); this one starts every visit fresh.
test.use({ storageState: { cookies: [], origins: [] } });

type FF = HTMLElement & {
  loadComposition(d: unknown): { ok: boolean };
  getShareUrl(): Promise<string>;
  composition: { pieces: { id: string; shapeId: string; x: number; y: number; rotation: number }[] };
};

const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = {
  'chromium-desktop': 'desktop',
  'webkit-iphone': 'wk-iphone',
  'webkit-iphone-landscape': 'wk-iphone-landscape',
};

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const gbtn = (page: Page, id: string) => el(page, `.guide [data-guide=${id}]`);
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const pieceCount = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as FF).composition.pieces.length);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('fridgeface:guide:v1'));

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

/** Load the page and wait for step 1 (after the intro). */
async function open(page: Page, url = '/?n=g') {
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
}

async function setNextMs(page: Page, ms: number) {
  await page.evaluate((ms) => { (customElements.get('fridge-face') as unknown as { guideNextMs: number }).guideNextMs = ms; }, ms);
}

/** The callout: inside the viewport and the board, clear of its target, the dock panels, the action bar and the tray. */
async function checkCallout(page: Page, label: string) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
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
    const arrow = sr.querySelector('.gpt')!;
    return {
      kind, side: g.dataset.side, callout: rect(g), arrow: g.dataset.side === 'centre' ? null : rect(arrow), target, controls,
      tray: rect(sr.querySelector('.tray')!), board: rect(sr.querySelector('.board')!), vw: window.innerWidth, vh: window.innerHeight,
    };
  });
  type R = { x: number; y: number; w: number; h: number };
  const ov = (a: R, b: R) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const c = m.callout;
  const where = `${label}: callout ${JSON.stringify(c)} (${m.kind}, ${m.side})`;
  expect.soft(c.w > 0 && c.h > 0, `${where} has a size`).toBe(true);
  expect.soft(c.x >= -0.5 && c.y >= -0.5 && c.x + c.w <= m.vw + 0.5 && c.y + c.h <= m.vh + 0.5, `${where} inside the viewport`).toBe(true);
  expect.soft(c.x >= m.board.x - 0.5 && c.x + c.w <= m.board.x + m.board.w + 0.5 && c.y >= m.board.y - 0.5 && c.y + c.h <= m.board.y + m.board.h + 0.5, `${where} inside the board`).toBe(true);
  if (m.target) {
    expect.soft(ov(c, m.target), `${where} overlaps its target ${JSON.stringify(m.target)}`).toBe(false);
    if (m.arrow) expect.soft(ov(m.arrow, m.target), `${where}: the arrow ${JSON.stringify(m.arrow)} overlaps the target`).toBe(false);
  }
  expect.soft(ov(c, m.tray), `${where} overlaps the tray`).toBe(false);
  for (const k of m.controls) expect.soft(ov(c, k.r), `${where} overlaps ${k.name} ${JSON.stringify(k.r)}`).toBe(false);
  return m;
}

async function shoot(page: Page, project: string, step: number) {
  await page.screenshot({ path: `${SHOT}/guide-step${step}-${project}.png` });
  const n = NAMES[project];
  if (n) await page.screenshot({ path: `${SHOT}/guide-step${step}-${n}.png` });
}

/** Drag the rotate handle sideways (a mouse drag: every profile delivers it). */
async function dragHandle(page: Page) {
  const h = await el(page, '[data-handle] circle').first().boundingBox();
  const x = h!.x + h!.width / 2, y = h!.y + h!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 8, y + i * 2);
  await page.mouse.up();
}

/** Does the composition hold a negative piece overlapping a positive one below it? (the shapes' real outlines) */
const cutPairCount = (page: Page) =>
  page.evaluate(async () => {
    const load = (u: string) => import(/* @vite-ignore */ u);
    const { cutPairs } = await load('/src/guide.ts');
    const { SHAPES } = await load('/src/shapes.ts');
    const by = new Map(SHAPES.map((s: { id: string }) => [s.id, s]));
    const pieces = (document.querySelector('fridge-face') as FF).composition.pieces;
    return cutPairs({ pieces, polarityOf: (id: string) => (by.get(id) as { polarity: string } | undefined)?.polarity, hullOf: (id: string) => (by.get(id) as { hull: unknown } | undefined)?.hull }).length as number;
  });

test('happy path: intro, then add, rotate, cut, Start fresh (one undo brings it back); placed well in every layout', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await page.goto('/?n=happy');
  await ready(page);
  // The intro plays first; the guide waits for it.
  // Measured in one go (the intro may end at any moment): while it is playing, the callout is hidden.
  const during = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const playing = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')].some((g) => g.getAnimations().some((a) => a.playState === 'running'));
    return { playing, hidden: sr.querySelector<HTMLElement>('.guide')!.hidden };
  });
  if (during.playing) expect(during.hidden, 'no callout during the intro').toBe(true);
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
  // Non-modal: it never takes focus on load. Its words go to the polite live region.
  expect(await page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide'))).toBe(false);
  await expect(el(page, '#ff-live')).toContainText('Drag a shape from the tray onto the board.');
  await expect(el(page, '.guide .gt1')).toHaveText('Drag a shape from the tray onto the board.');
  await expect(gbtn(page, 'skip')).toHaveText('Skip');
  await expect(gbtn(page, 'off')).toHaveText("Don't show again");
  await expect(gbtn(page, 'next')).toBeHidden();
  const m1 = await checkCallout(page, 'step 1');
  expect(m1.kind).toBe('tray');
  expect(m1.side, 'phones in landscape: right of the tray; otherwise above it').toBe(info.project.name.endsWith('landscape') ? 'right' : 'above');
  await shoot(page, info.project.name, 1);

  // Step 1 -> 2: add a piece from the tray (a positive stem, at the centre of the board).
  const n0 = await pieceCount(page);
  await press(isMobile, el(page, '.tray button[data-shape="positive-stem"]'));
  await expect.poll(() => pieceCount(page)).toBe(n0 + 1);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await expect(guide(page)).toBeVisible();
  // Touch devices (the Controls panel's own detection) add the two-finger twist, in one sentence.
  await expect(el(page, '.guide .gt1')).toHaveText(isMobile ? 'Drag the round handle to turn it, or twist with two fingers.' : 'Drag the round handle to turn it.');
  const m2 = await checkCallout(page, 'step 2');
  expect(m2.kind).toBe('handle');
  await shoot(page, info.project.name, 2);

  // Step 2 -> 3: turn it with the handle.
  await dragHandle(page);
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await expect(guide(page)).toBeVisible();
  await expect(el(page, '.guide .gt1')).toHaveText('White shapes cut into black. Drop one on top of a black shape.');
  // The intro's cuts are on the board, and they do not complete step 3.
  expect(await cutPairCount(page), 'precondition: the intro has negative-over-positive pairs').toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await checkCallout(page, 'step 3');
  await shoot(page, info.project.name, 3);

  // Step 3 -> 4: a negative round lands on top of the new stem (tray adds go on top, near the centre).
  await press(isMobile, el(page, '.tray button[data-shape="negative-round"]'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await expect(guide(page)).toBeVisible();
  await expect(el(page, '.guide .gt1')).toHaveText('Now try making your name.');
  await expect(gbtn(page, 'fresh')).toHaveText('Start fresh');
  await expect(gbtn(page, 'keep')).toHaveText('Keep playing');
  await expect(el(page, '.guide .gnote')).toHaveText("Need ideas? Open Letters (abc). There's no wrong way.");
  await expect(el(page, '.guide .gnote .gabc svg')).toBeVisible();
  // No Skip on step 4 (Keep playing does that); "Don't show again" stays, small and secondary.
  await expect(gbtn(page, 'skip')).toBeHidden();
  await expect(gbtn(page, 'off')).toBeVisible();
  const [offH, keepH] = await Promise.all([gbtn(page, 'off').boundingBox(), gbtn(page, 'keep').boundingBox()]);
  expect(offH!.height, "Don't show again is visually smaller than Keep playing").toBeLessThan(keepH!.height);
  const m4 = await checkCallout(page, 'step 4');
  expect(m4.side, 'step 4 is centred on the board').toBe('centre');
  await shoot(page, info.project.name, 4);

  // Start fresh: the board empties as ONE undoable step, and the guide ends.
  const before = await pieceCount(page);
  await press(isMobile, gbtn(page, 'fresh'));
  await expect.poll(() => pieceCount(page)).toBe(0);
  await expect(guide(page)).toBeHidden();
  await press(isMobile, el(page, '[data-history=undo]'));
  await expect.poll(() => pieceCount(page)).toBe(before);
  await expect(guide(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('step 3 does not complete from the intro pieces; Next appears after waiting (shortened timer) and walks the steps', async ({ page }) => {
  await open(page);
  await setNextMs(page, 250); // applies from the next step on
  expect(await cutPairCount(page)).toBeGreaterThan(0);
  // Step 1's timer is the real 10 s one: no Next yet.
  await page.waitForTimeout(500);
  await expect(gbtn(page, 'next')).toBeHidden();
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('3'); // a negative stem from the keyboard: another add method
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await expect(gbtn(page, 'next')).toBeVisible();
  await gbtn(page, 'next').click();
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  // Waiting, panning and adding a POSITIVE piece on top of things changes nothing: no new negative-over-positive pair.
  await page.waitForTimeout(600);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await expect(gbtn(page, 'next')).toBeVisible();
  await gbtn(page, 'next').click();
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await page.waitForTimeout(500);
  await expect(gbtn(page, 'next'), 'step 4 has no Next').toBeHidden();
  await gbtn(page, 'keep').click();
  await expect(guide(page)).toBeHidden();
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
  await page.waitForTimeout(2500); // past the end of any intro
  await expect(guide(page)).toBeHidden();
  // Controls -> Show guide (in every section state of the panel).
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
  // A replay is asked for: focus moves into the callout.
  await expect.poll(() => page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.guide'))).toBe(true);
  expect(await stored(page), "replaying keeps Don't show again").toBe('off');
});

test('a share-link visit still shows the guide; opening the link does not count as adding a piece', async ({ page, browser }, info) => {
  await open(page);
  const url = await page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    ff.loadComposition({ v: 1, pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }, { s: 'negative-round', x: 10, y: 0, r: 0 }] });
    return ff.getShareUrl();
  });
  expect(url).toContain('#c=');
  const opts = { ...info.project.use } as Record<string, unknown>;
  const ctx = await browser.newContext({ ...opts, storageState: { cookies: [], origins: [] } });
  const p = await ctx.newPage();
  await p.goto(url);
  await ready(p);
  await expect.poll(() => pieceCount(p)).toBe(2);
  await expect(guide(p)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(guide(p)).toBeVisible();
  await p.waitForTimeout(300);
  await expect(guide(p), 'the loaded pieces did not complete step 1').toHaveAttribute('data-step', '1');
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
  await page.waitForTimeout(2500);
  await expect(guide(page)).toBeHidden();
  await expect(guide(page)).toHaveAttribute('data-step', '0');
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await el(page, '[data-menu=help]').tap();
  } else await el(page, '[data-view=help]').click();
  await expect(el(page, '.help')).toBeVisible();
  await expect(el(page, '[data-help=guide]')).toBeHidden();
});

test('Escape: the Letters sheet closes first, then the guide is skipped, then the selection clears', async ({ page, isMobile }) => {
  await open(page);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('2'); // add (and select) a positive round: step 2
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await page.keyboard.press('l');
  await expect(el(page, '.sugg')).toBeVisible();
  await expect(guide(page), 'hidden while the sheet is open').toBeHidden();
  await page.keyboard.press('Escape');
  await expect(el(page, '.sugg')).toBeHidden();
  await expect(guide(page), 'back after').toBeVisible();
  await expect(el(page, '.actions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  await expect(el(page, '.actions'), 'the selection is still there').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.actions')).toBeHidden();
  void isMobile;
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
  // The callout's buttons are real buttons in the Tab order.
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

test('the callout follows the view and the window: still placed well after a zoom and a resize', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a desktop window can be resized freely');
  await open(page);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('5'); // a wedge: step 2 points at its handle
  await expect(guide(page)).toHaveAttribute('data-target', 'handle');
  const a = await checkCallout(page, 'before');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  const b = await checkCallout(page, 'zoomed in');
  expect(b.target!.y, 'the handle moved with the zoom').not.toBeCloseTo(a.target!.y, 0);
  await page.setViewportSize({ width: 900, height: 640 });
  await checkCallout(page, 'resized');
  await page.setViewportSize({ width: 390, height: 700 }); // narrow: the compact layout
  await checkCallout(page, 'narrow');
});

test('reduced motion: the pointer does not move', async ({ browser }, info) => {
  const opts = { ...info.project.use } as Record<string, unknown>;
  for (const reduce of [false, true]) {
    const ctx = await browser.newContext({ ...opts, storageState: { cookies: [], origins: [] }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    await open(p);
    const running = await p.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelector('.gpt svg')!.getAnimations().length);
    if (reduce) expect(running, 'no pointer animation with reduced motion').toBe(0);
    else expect(running, 'the pointer nudges toward the target').toBeGreaterThan(0);
    await ctx.close();
  }
});

test('axe: no violations with a callout showing (steps 1 and 4)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await open(page);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const run = () => page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(await run()).toEqual([]);
  await setNextMs(page, 50);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('1');
  for (const s of ['3', '4']) {
    await gbtn(page, 'next').click();
    await expect(guide(page)).toHaveAttribute('data-step', s);
  }
  await expect(guide(page)).toBeVisible();
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

test('with a callout showing, the board still works around it: select an intro piece, drag a shape from the tray onto open board; compact hit areas stay 44px', async ({ page, isMobile }) => {
  await open(page);
  await checkCallout(page, 'step 1');
  // Small controls keep 44px touch targets through their hit areas.
  const hits = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.guide .gctl button:not([hidden])')].map((b) => {
    const r = b.getBoundingClientRect();
    const a = getComputedStyle(b, '::after');
    const px = (v: string) => parseFloat(v) || 0;
    return { h: r.height - px(a.top) - px(a.bottom), w: r.width - px(a.left) - px(a.right) };
  }));
  for (const h of hits) expect(h.h, 'hit area height').toBeGreaterThanOrEqual(44);
  // Points that are on the board and clear of the callout and every control.
  const spots = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const blocked = (x: number, y: number) => {
      const e = sr.elementFromPoint(x, y) as Element | null;
      return !e || !!e.closest('.guide, .dock, .actions, .tray, .menu');
    };
    // An intro piece whose centre is not under the callout.
    let piece: { id: string; x: number; y: number } | null = null;
    for (const p of ff.composition.pieces) {
      const g = sr.querySelector(`[data-piece-id="${p.id}"] .bd`)!.getBoundingClientRect();
      const x = g.left + g.width / 2, y = g.top + g.height / 2;
      if ((sr.elementFromPoint(x, y) as Element | null)?.closest('[data-piece-id]')?.getAttribute('data-piece-id') === p.id) { piece = { id: p.id, x, y }; break; }
    }
    // Open board: no piece, no callout, no control, with a margin.
    const b = sr.querySelector('.board')!.getBoundingClientRect();
    let open: { x: number; y: number } | null = null;
    for (let y = b.top + 40; y < b.bottom - 40 && !open; y += 20) for (let x = b.left + 40; x < b.right - 40 && !open; x += 20) {
      const ok = [[0, 0], [-30, -30], [30, 30], [-30, 30], [30, -30]].every(([dx, dy]) => !blocked(x + dx, y + dy) && !(sr.elementFromPoint(x + dx, y + dy) as Element).closest('[data-piece-id]'));
      if (ok) open = { x, y };
    }
    return { piece, open };
  });
  expect(spots.piece, 'an intro piece is reachable').not.toBeNull();
  expect(spots.open, 'open board is reachable').not.toBeNull();
  if (isMobile) await page.touchscreen.tap(spots.piece!.x, spots.piece!.y);
  else await page.mouse.click(spots.piece!.x, spots.piece!.y);
  await expect.poll(() => page.evaluate(() => (document.querySelector('fridge-face') as unknown as { selection: string[] }).selection)).toEqual([spots.piece!.id]);
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  // Drag the wedge from the tray to the open spot (a mouse drag: every profile delivers it).
  const n = await pieceCount(page);
  const w = await el(page, '.tray button[data-shape="wedge"]').boundingBox();
  await page.mouse.move(w!.x + w!.width / 2, w!.y + w!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(w!.x + w!.width / 2 + ((spots.open!.x - w!.x - w!.width / 2) * i) / 12, w!.y + w!.height / 2 + ((spots.open!.y - w!.y - w!.height / 2) * i) / 12);
  await page.mouse.up();
  await expect.poll(() => pieceCount(page)).toBe(n + 1);
  const at = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    const ps = ff.composition.pieces;
    const g = ff.shadowRoot!.querySelector(`[data-piece-id="${ps[ps.length - 1].id}"] .bd`)!.getBoundingClientRect();
    return { x: g.left + g.width / 2, y: g.top + g.height / 2 };
  });
  expect(Math.hypot(at.x - spots.open!.x, at.y - spots.open!.y), 'it landed where it was dropped').toBeLessThan(40);
  await expect(guide(page)).toHaveAttribute('data-step', '2');
});
