import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * Layout gate, in Chromium AND WebKit: phones get the compact layout (icon buttons, small tray), desktops the
 * desktop one; tray, docks and action bar never overlap; the page never scrolls; a tray tap/click adds a piece;
 * and the console stays clean. Screenshots land in .playwright-mcp/ (gitignored).
 */

const SHOT: Record<string, string> = {
  'webkit-iphone': 'wk-iphone',
  'webkit-iphone-landscape': 'wk-iphone-landscape',
  'webkit-desktop': 'wk-desktop',
  'chromium-iphone': 'cr-iphone',
  'chromium-iphone-landscape': 'cr-iphone-landscape',
  'chromium-desktop': 'cr-desktop',
};

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Everything the layout assertions need, measured in the page. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('fridge-face')!;
    const sr = host.shadowRoot!;
    const root = sr.querySelector<HTMLElement>('.root')!;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const undo = sr.querySelector('[data-history=undo]')!;
    const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none';
    const panels = [...sr.querySelectorAll<HTMLElement>('.dock > .panel')].filter((p) => !p.hidden && getComputedStyle(p).display !== 'none');
    const actions = sr.querySelector<HTMLElement>('.actions')!;
    const se = document.scrollingElement!;
    return {
      tk: parseFloat(getComputedStyle(root).getPropertyValue('--tk')),
      k: parseFloat(getComputedStyle(root).getPropertyValue('--k')),
      iconShown: shown(undo.querySelector('.ic')),
      textShown: shown(undo.querySelector('.tx')),
      tray: rect(sr.querySelector('.tray')!),
      dock: panels.map((p) => ({ name: p.className, r: rect(p) })),
      actions: actions.hidden ? null : rect(actions),
      vw: window.innerWidth,
      vh: window.innerHeight,
      scroll: { sh: se.scrollHeight, sw: se.scrollWidth, ch: se.clientHeight, cw: se.clientWidth },
      pieces: sr.querySelectorAll('[data-pieces] > [data-piece-id]').length,
    };
  });
}

test('compact layout on phones, desktop layout on desktops; no overlaps, no scroll, tray adds a piece, clean console', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await open(page);
  const portrait = isMobile && page.viewportSize()!.height > page.viewportSize()!.width;
  const landscape = isMobile && !portrait;

  // 1. The right layout for the device.
  const m = await measure(page);
  if (isMobile) {
    expect.soft(m.iconShown, 'phone: icon buttons are showing').toBe(true);
    expect.soft(m.textShown, 'phone: button text is hidden').toBe(false);
    if (portrait) expect.soft(m.tk, 'phone portrait: compact tray scale').toBeCloseTo(0.17, 3);
    else {
      // Landscape: the tray scale shrinks (never grows) so all five shapes fit the height of the vertical tray.
      expect.soft(m.tk, 'phone landscape: tray scale at most the compact one').toBeLessThanOrEqual(0.17);
      expect.soft(m.tk, 'phone landscape: tray scale still comfortable').toBeGreaterThan(0.13);
    }
    expect.soft(m.k, 'phone: compact board scale').toBeCloseTo(0.17, 3);
    if (portrait) expect.soft(m.tray.height / m.vh, 'phone portrait: tray height / viewport height').toBeLessThanOrEqual(0.22);
  } else {
    expect.soft(m.iconShown, 'desktop: icons hidden').toBe(false);
    expect.soft(m.textShown, 'desktop: text labels showing').toBe(true);
    expect.soft(m.tk, 'desktop: tray scale').toBeCloseTo(0.32, 3);
    expect.soft(m.k, 'desktop: board scale').toBeCloseTo(0.3, 3);
  }

  // 2. Adding a piece from the tray (a tap on touch devices, a click otherwise) adds and selects it.
  const before = m.pieces;
  const wedge = page.locator('fridge-face .tray button[data-shape="wedge"]');
  if (isMobile) await wedge.tap();
  else await wedge.click();
  await expect.poll(async () => (await measure(page)).pieces, { message: 'tray adds a piece' }).toBe(before + 1);
  await expect(page.locator('fridge-face .actions')).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900))); // let any intro slide and the lift settle

  // 3. No overlaps between the tray, the dock panels and the action bar; everything inside the viewport.
  const after = await measure(page);
  const boxes = [{ name: 'tray', r: after.tray }, ...after.dock, ...(after.actions ? [{ name: 'actions', r: after.actions }] : [])];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    expect.soft(b.r.x >= -0.5 && b.r.y >= -0.5 && b.r.x + b.r.width <= after.vw + 0.5 && b.r.y + b.r.height <= after.vh + 0.5, `${b.name} inside the viewport ${JSON.stringify(b.r)}`).toBe(true);
    for (let j = i + 1; j < boxes.length; j++) {
      const c = boxes[j];
      expect.soft(overlaps(b.r, c.r), `${b.name} ${JSON.stringify(b.r)} overlaps ${c.name} ${JSON.stringify(c.r)}`).toBe(false);
    }
  }

  // 3b. Phones: docks at the TOP, action bar at the BOTTOM just above the tray (portrait) or at the bottom of the board, right
  // of the vertical tray (landscape). Desktop: the reverse (unchanged).
  const dockTop = Math.min(...after.dock.map((d) => d.r.y));
  if (landscape && after.actions) {
    expect.soft(after.tray.x, 'landscape: tray on the left edge').toBeLessThan(0.5);
    expect.soft(after.tray.height, 'landscape: tray runs the full height').toBeGreaterThanOrEqual(after.vh - 0.5);
    expect.soft(after.tray.width, 'landscape: tray is a vertical column').toBeLessThan(after.tray.height);
    expect.soft(dockTop, 'landscape: docks sit at the top of the board').toBeLessThan(20);
    for (const b of [...after.dock.map((d) => d.r), after.actions]) expect.soft(b.x, "landscape: board controls start right of the tray").toBeGreaterThanOrEqual(after.tray.x + after.tray.width - 0.5);
    expect.soft(after.actions.y + after.actions.height, 'landscape: action bar at the bottom of the board').toBeGreaterThan(after.vh - 20);
  } else if (isMobile && after.actions) {
    expect.soft(dockTop, 'phone: docks sit at the top of the board').toBeLessThan(20);
    expect.soft(dockTop, "phone: docks' top < action bar's top").toBeLessThan(after.actions.y);
    expect.soft(after.actions.y + after.actions.height, "phone: action bar's bottom <= tray's top").toBeLessThanOrEqual(after.tray.y + 0.5);
  } else if (after.actions) {
    expect.soft(after.actions.y, 'desktop: action bar at the top').toBeLessThan(20);
    expect.soft(dockTop, 'desktop: docks at the bottom, above the tray').toBeGreaterThan(after.actions.y + after.actions.height);
  }

  // 4. No page scroll.
  expect.soft(after.scroll.sh, 'page height fits').toBeLessThanOrEqual(after.scroll.ch + 1);
  expect.soft(after.scroll.sw, 'page width fits').toBeLessThanOrEqual(after.scroll.cw + 1);
  await page.evaluate(() => window.scrollTo(0, 200));
  expect.soft(await page.evaluate(() => window.scrollY), 'page does not scroll').toBe(0);

  const name = SHOT[info.project.name];
  if (name) await page.screenshot({ path: `.playwright-mcp/${name}${process.env.SHOT_SUFFIX ?? ''}.png` });

  // 5. Zero console errors.
  expect(errors, 'console errors').toEqual([]);
});

test('the layout state is set synchronously on connect (no flash of the desktop layout)', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:700px';
    document.body.append(box);
    const el = document.createElement('fridge-face');
    el.setAttribute('no-intro', '');
    el.style.cssText = 'position:static;width:100%;height:100%'; // the demo page pins <fridge-face> full screen
    box.append(el); // connectedCallback runs here
    const root = el.shadowRoot!.querySelector('.root')!;
    const out = {
      compact: root.hasAttribute('data-compact'),
      tk: parseFloat(getComputedStyle(root).getPropertyValue('--tk')),
      text: getComputedStyle(el.shadowRoot!.querySelector('[data-history=undo] .tx')!).display,
    };
    box.remove();
    return out;
  });
  expect(r).toEqual({ compact: true, tk: 0.17, text: 'none' });
});

test('rotation snapping is gone: no snap or 15 degree buttons on any layout; the action bar is Delete, Bring forward, Send backward', async ({ page, isMobile }) => {
  await open(page);
  const wedge = page.locator('fridge-face .tray button[data-shape="wedge"]');
  if (isMobile) await wedge.tap();
  else await wedge.click();
  await expect(page.locator('fridge-face .actions')).toBeVisible();
  for (const sel of ['[data-action=snap]', '[data-action=rotate-left]', '[data-action=rotate-right]']) await expect(page.locator(`fridge-face ${sel}`)).toHaveCount(0);
  const labels = await page.locator('fridge-face .actions button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  expect(labels).toEqual(['Delete piece', 'Bring forward', 'Send backward']);
  // Nothing about snapping or 15 degree steps anywhere in the toy, including the Controls dialog.
  // (Data URLs stripped: the texture tiles are base64 JPEGs, which can contain any letters by chance, "snap" included, v1.4.1.)
  const text = (await page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.innerHTML)).replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
  expect(text).not.toMatch(/snap|15\u00b0|15°|15 degree/i);
});

test('free rotation: , and . turn 1 degree (coalesced into one undo step); Shift + them, < > and S do nothing; any rotation loads unchanged', async ({ page }) => {
  await page.goto('/?n=rot');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.keyboard.press('Shift');
  type FF = HTMLElement & { loadComposition(d: unknown): { ok: boolean }; getComposition(): { pieces: { s: string; x: number; y: number; r: number }[] }; undo(): void };
  // Old share links and saves may hold any rotation, including former 15 degree steps and odd angles: they load as they are.
  const loaded = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    ff.loadComposition({ v: 1, pieces: [{ s: 'wedge', x: 0, y: 0, r: 7.33 }, { s: 'positive-stem', x: 200, y: 0, r: -45 }, { s: 'negative-round', x: 400, y: 0, r: 172.5 }] });
    return ff.getComposition().pieces.map((p) => p.r);
  });
  expect(loaded).toEqual([7.33, -45, 172.5]);
  await page.locator('fridge-face .board svg.surface').focus();
  await page.keyboard.press('n'); // select the wedge (bottom of the stack)
  const r = () => page.evaluate(() => (document.querySelector('fridge-face') as FF).getComposition().pieces[0].r);
  for (let i = 0; i < 5; i++) await page.keyboard.press('.');
  expect(await r()).toBeCloseTo(12.33, 6);
  await page.keyboard.press(',');
  expect(await r()).toBeCloseTo(11.33, 6);
  for (const k of ['Shift+Period', 'Shift+Comma', '<', '>', 's', 'S']) await page.keyboard.press(k);
  expect(await r(), 'no step rotation and no snap key').toBeCloseTo(11.33, 6);
  await expect(page.locator('fridge-face #ff-live')).toContainText('Wedge rotated to', { timeout: 2000 });
  await expect(page.locator('fridge-face #ff-live')).not.toContainText(/snap/i);
  // The 1 degree key presses were one undo step.
  await page.evaluate(() => (document.querySelector('fridge-face') as FF).undo());
  expect(await r()).toBeCloseTo(7.33, 6);
});
