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

  // 1. The right layout for the device.
  const m = await measure(page);
  if (isMobile) {
    expect.soft(m.iconShown, 'phone: icon buttons are showing').toBe(true);
    expect.soft(m.textShown, 'phone: button text is hidden').toBe(false);
    expect.soft(m.tk, 'phone: compact tray scale').toBeCloseTo(0.17, 3);
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
