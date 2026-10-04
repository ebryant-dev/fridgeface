import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * Phone layout positions, in Chromium AND WebKit: the docks (undo/redo/clear, zoom/fit/menu) sit at the TOP of the board,
 * the piece action bar at the BOTTOM just above the tray, the menu opens DOWNWARD, nothing overlaps in any state, and Fit /
 * the intro centre in the visible board (below the docks). Desktop keeps its layout: docks at the bottom, action bar at the top.
 */

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

const SIZES = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 844, h: 390 },
  { w: 932, h: 430 },
];

async function open(page: Page, query = '?n=1') {
  await page.goto('/' + query);
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.keyboard.press('Shift'); // finish the intro, if it is playing
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const settle = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 700)));

async function addPiece(page: Page, isMobile: boolean) {
  await press(isMobile, el(page, '.tray button[data-shape="wedge"]'));
  await expect(el(page, '.actions')).toBeVisible();
  await settle(page);
}

/** Every visible box that must not overlap, by name, plus the viewport. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const shown = (e: Element) => {
      const h = e as HTMLElement;
      const cs = getComputedStyle(h);
      return !h.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && h.getBoundingClientRect().width > 0;
    };
    const out: { name: string; r: { x: number; y: number; width: number; height: number } }[] = [];
    const add = (name: string, sel: string, root: ParentNode = sr) => {
      for (const e of root.querySelectorAll(sel)) if (shown(e)) out.push({ name, r: rect(e) });
    };
    add('tray', '.tray');
    add('shape', '.tray button[data-shape]');
    add('history', '.dock > .history');
    add('view', '.dock > .view');
    add('actions', '.actions');
    add('menu', '.menu');
    add('sugg', '.sugg');
    add('linkbox', '.dock > .linkbox');
    add('notice', '.dock > .notice .msg');
    add('credit', '.credit', document);
    return { boxes: out, vw: window.innerWidth, vh: window.innerHeight };
  });
}

const by = (b: { name: string; r: Rect }[], name: string) => b.find((x) => x.name === name)?.r;

async function expectClean(page: Page, label: string) {
  const s = await boxes(page);
  for (let i = 0; i < s.boxes.length; i++) {
    const a = s.boxes[i];
    expect.soft(a.r.x >= -0.5 && a.r.y >= -0.5 && a.r.x + a.r.width <= s.vw + 0.5 && a.r.y + a.r.height <= s.vh + 0.5, `[${label}] ${a.name} inside the viewport ${JSON.stringify(a.r)}`).toBe(true);
    for (let j = i + 1; j < s.boxes.length; j++) {
      const b = s.boxes[j];
      if ((a.name === 'tray' && b.name === 'credit') || (a.name === 'tray' && b.name === 'shape') || (a.name === 'shape' && b.name === 'tray')) continue; // the credit lives in the tray's reserved bottom strip; shapes are inside the tray
      expect.soft(overlaps(a.r, b.r), `[${label}] ${a.name} ${JSON.stringify(a.r)} overlaps ${b.name} ${JSON.stringify(b.r)}`).toBe(false);
    }
  }
  return s;
}

test('phone: docks on top, action bar just above the tray, menu opens downward, no overlaps in any state', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'phone profiles only');
  const landscape = page.viewportSize()!.width > page.viewportSize()!.height;
  const sizes = landscape ? SIZES.filter((z) => z.w > z.h) : SIZES.filter((z) => z.h > z.w);
  for (const z of sizes) {
    await page.setViewportSize({ width: z.w, height: z.h });
    await open(page);
    const tag = `${z.w}x${z.h}`;

    // idle
    let s = await expectClean(page, `${tag} idle`);
    const dock = [by(s.boxes, 'history')!, by(s.boxes, 'view')!];
    expect.soft(Math.min(...dock.map((r) => r.y)), `${tag} docks at the top`).toBeLessThan(20);
    expect.soft(by(s.boxes, 'history')!.x, `${tag} undo group on the left`).toBeLessThan(by(s.boxes, 'view')!.x);
    expect.soft(by(s.boxes, 'view')!.x + by(s.boxes, 'view')!.width, `${tag} view group on the right`).toBeGreaterThan(z.w - 20);

    // selected
    await addPiece(page, isMobile);
    s = await expectClean(page, `${tag} selected`);
    const act = by(s.boxes, 'actions')!;
    const tray = by(s.boxes, 'tray')!;
    expect.soft(Math.max(...dock.map((r) => r.y)), `${tag} docks' top < action bar's top`).toBeLessThan(act.y);
    expect.soft(act.y + act.height, `${tag} action bar's bottom <= tray's top`).toBeLessThanOrEqual(tray.y + 0.5);
    expect.soft(tray.y - (act.y + act.height), `${tag} action bar sits directly above the tray`).toBeLessThanOrEqual(12);
    if (info.project.name === 'webkit-iphone') await page.screenshot({ path: `.playwright-mcp/swap-try-${tag}-selected.png` });

    // menu open, downward, inside the viewport
    await press(isMobile, el(page, '[data-view=menu]'));
    await expect(el(page, '.menu')).toBeVisible();
    s = await expectClean(page, `${tag} menu`);
    let menu = by(s.boxes, 'menu')!;
    const mb = by(s.boxes, 'view')!;
    expect.soft(menu.y, `${tag} menu opens below its button`).toBeGreaterThanOrEqual(mb.y + mb.height - 0.5);
    expect.soft(menu.y + menu.height, `${tag} menu stays above the action bar`).toBeLessThanOrEqual(act.y + 0.5);

    // menu with Download expanded
    await press(isMobile, el(page, '[data-menu=download]'));
    await expect(el(page, '[data-menu=png]')).toBeVisible();
    s = await expectClean(page, `${tag} menu+download`);
    menu = by(s.boxes, 'menu')!;
    expect.soft(menu.y, `${tag} expanded menu still below its button`).toBeGreaterThanOrEqual(mb.y + mb.height - 0.5);
    await page.keyboard.press('Escape');
    await expect(el(page, '.menu')).toBeHidden();

    // clear-confirm
    await press(isMobile, el(page, '[data-history=clear]'));
    await expect(el(page, '[data-history=clear-yes]')).toBeVisible();
    await expectClean(page, `${tag} clear-confirm`);
    await press(isMobile, el(page, '[data-history=clear-no]'));

    // share fallback field + notice (clipboard blocked)
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true }));
    await el(page, '.board svg.surface').focus();
    await page.keyboard.press('c');
    await expect(el(page, '.linkbox')).toBeVisible();
    s = await expectClean(page, `${tag} share fallback`);
    expect.soft(by(s.boxes, 'linkbox')!.y, `${tag} share field below the docks`).toBeGreaterThanOrEqual(Math.max(...dock.map((r) => r.y + r.height)) - 0.5);
    await press(isMobile, el(page, '[data-share=close]'));
    await expect(el(page, '.linkbox')).toBeHidden();

    // notice
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true }));
    await el(page, '.board svg.surface').focus();
    await page.keyboard.press('c');
    await expect(el(page, '.notice .msg')).toHaveText('Link copied');
    await expectClean(page, `${tag} notice`);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 2600)));

    // letters sheet: it covers the bottom of the board, and the action bar hides while it is open
    await el(page, '.board svg.surface').focus();
    await page.keyboard.press('l');
    await expect(el(page, '.sugg')).toBeVisible();
    s = await expectClean(page, `${tag} letters`);
    expect.soft(by(s.boxes, 'actions'), `${tag} action bar hidden while the letters sheet is open`).toBeUndefined();
    expect.soft(by(s.boxes, 'sugg')!.y, `${tag} sheet clear of the docks`).toBeGreaterThanOrEqual(Math.max(...dock.map((r) => r.y + r.height)) - 0.5);
    await page.keyboard.press('Escape');
    await expect(el(page, '.sugg')).toBeHidden();
    await expect(el(page, '.actions')).toBeVisible();
  }
});

test('phone: Fit and the intro centre in the visible board, below the docks', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  const measure = () =>
    page.evaluate(() => {
      const sr = document.querySelector('fridge-face')!.shadowRoot!;
      const rs = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')].map((g) => g.getBoundingClientRect());
      const top = Math.min(...rs.map((r) => r.top));
      const bottom = Math.max(...rs.map((r) => r.bottom));
      const dockBottom = Math.max(...[...sr.querySelectorAll('.dock > .history, .dock > .view')].map((p) => p.getBoundingClientRect().bottom));
      const trayTop = sr.querySelector('.tray')!.getBoundingClientRect().top;
      return { top, bottom, dockBottom, trayTop };
    });
  // The intro (first visit, no ?n=1) leaves "play" framed in the visible board.
  await page.goto('/');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.waitForTimeout(3500);
  let m = await measure();
  expect.soft(m.top, 'intro: word below the docks').toBeGreaterThanOrEqual(m.dockBottom);
  expect.soft(m.bottom, 'intro: word above the tray').toBeLessThanOrEqual(m.trayTop);
  expect.soft(Math.abs((m.top + m.bottom) / 2 - (m.dockBottom + m.trayTop) / 2), 'intro: centred in the visible board').toBeLessThanOrEqual(24);
  // Fit again, after Fit pressed.
  await press(isMobile, el(page, '[data-view=out]'));
  await press(isMobile, el(page, '[data-view=out]'));
  await press(isMobile, el(page, '[data-view=fit]'));
  await settle(page);
  m = await measure();
  expect.soft(m.top, 'fit: composition below the docks').toBeGreaterThanOrEqual(m.dockBottom);
  expect.soft(m.bottom, 'fit: composition above the tray').toBeLessThanOrEqual(m.trayTop);
  expect.soft(Math.abs((m.top + m.bottom) / 2 - (m.dockBottom + m.trayTop) / 2), 'fit: centred in the visible board').toBeLessThanOrEqual(24);
});

test('phone: a suggestion placed from the letters sheet lands below the docks and above the tray', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await press(isMobile, el(page, '[data-history=clear]'));
  await press(isMobile, el(page, '[data-history=clear-yes]'));
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('l');
  await expect(el(page, '.sugg')).toBeVisible();
  await press(isMobile, el(page, '.sugg .sgvars button, .sugg .sgwords button').first());
  await expect(el(page, '.sugg')).toBeHidden();
  await settle(page);
  const m = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const rs = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')].map((g) => g.getBoundingClientRect());
    return {
      n: rs.length,
      top: Math.min(...rs.map((r) => r.top)),
      bottom: Math.max(...rs.map((r) => r.bottom)),
      dockBottom: Math.max(...[...sr.querySelectorAll('.dock > .history, .dock > .view')].map((p) => p.getBoundingClientRect().bottom)),
      trayTop: sr.querySelector('.tray')!.getBoundingClientRect().top,
    };
  });
  expect(m.n, 'a suggestion was placed').toBeGreaterThan(0);
  expect(m.top, 'placed pieces below the docks').toBeGreaterThanOrEqual(m.dockBottom);
  expect(m.bottom, 'placed pieces above the tray').toBeLessThanOrEqual(m.trayTop);
  expect(Math.abs((m.top + m.bottom) / 2 - (m.dockBottom + 8 + m.trayTop) / 2), 'centred in the visible board').toBeLessThanOrEqual(6);
});

test('desktop layout is unchanged: docks at the bottom, action bar at the top', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop profiles only');
  await open(page);
  await addPiece(page, false);
  const s = await expectClean(page, 'desktop');
  const act = by(s.boxes, 'actions')!;
  const hist = by(s.boxes, 'history')!;
  const tray = by(s.boxes, 'tray')!;
  expect(act.y, 'action bar at the top (10px)').toBeCloseTo(10, 0);
  expect(tray.y - (hist.y + hist.height), 'docks sit 10px above the tray').toBeCloseTo(10, 0);
  expect(hist.y).toBeGreaterThan(act.y);
  if (process.env.SHOT_SUFFIX === undefined) await page.screenshot({ path: '.playwright-mcp/swap-desktop.png' });
});
