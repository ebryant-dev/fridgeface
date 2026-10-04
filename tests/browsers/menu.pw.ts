import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The phone menu (☰), in Chromium AND WebKit: on phones it holds share, download, letters and keyboard shortcuts;
 * on desktop there is no menu and the original buttons are all there. Menu tests run on the phone profiles only.
 */

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
  await page.goto('/?n=1');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.keyboard.press('Shift'); // finish the intro, if it is playing
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const menuBtn = (page: Page) => el(page, '[data-view=menu]');
const menu = (page: Page) => el(page, '.menu');
const item = (page: Page, id: string) => el(page, `[data-menu=${id}]`);
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const activeMenuId = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null)?.dataset.menu ?? (document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null)?.dataset.view ?? '');

async function addPiece(page: Page, isMobile: boolean) {
  await press(isMobile, el(page, '.tray button[data-shape="wedge"]'));
  await expect(el(page, '.actions')).toBeVisible();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
}

/** Rects of everything that must not overlap, plus the viewport and the camera/selection state. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const shown = (e: HTMLElement) => !e.hidden && getComputedStyle(e).display !== 'none';
    const boxes: { name: string; r: Rect }[] = [{ name: 'tray', r: rect(sr.querySelector('.tray')!) }];
    for (const p of sr.querySelectorAll<HTMLElement>('.dock > .panel')) if (shown(p)) boxes.push({ name: `dock ${p.className}`, r: rect(p) });
    const actions = sr.querySelector<HTMLElement>('.actions')!;
    if (shown(actions)) boxes.push({ name: 'actions', r: rect(actions) });
    const m = sr.querySelector<HTMLElement>('.menu')!;
    if (shown(m)) boxes.push({ name: 'menu', r: rect(m) });
    return {
      boxes,
      vw: window.innerWidth,
      vh: window.innerHeight,
      camera: sr.querySelector('[data-camera]')!.getAttribute('transform'),
      selected: !!sr.querySelector('[data-selected], .actions:not([hidden])'),
      pieces: sr.querySelectorAll('[data-pieces] > [data-piece-id]').length,
    };
  });
}

async function expectNoOverlaps(page: Page) {
  const s = await snapshot(page);
  for (let i = 0; i < s.boxes.length; i++) {
    const b = s.boxes[i];
    expect.soft(b.r.x >= -0.5 && b.r.y >= -0.5 && b.r.x + b.r.width <= s.vw + 0.5 && b.r.y + b.r.height <= s.vh + 0.5, `${b.name} inside the viewport ${JSON.stringify(b.r)}`).toBe(true);
    for (let j = i + 1; j < s.boxes.length; j++) expect.soft(overlaps(b.r, s.boxes[j].r), `${b.name} ${JSON.stringify(b.r)} overlaps ${s.boxes[j].name} ${JSON.stringify(s.boxes[j].r)}`).toBe(false);
  }
}

test('desktop: no menu button, the original buttons are all there', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop profiles only');
  await open(page);
  await expect(menuBtn(page)).toBeHidden();
  await expect(el(page, '[data-share=copy]')).toBeVisible();
  await expect(el(page, '[data-share=export]')).toBeVisible();
  await expect(el(page, '[data-view=help]')).toBeVisible();
  const hasSugg = await page.evaluate(() => !document.querySelector('fridge-face')!.shadowRoot!.querySelector<HTMLElement>('[data-view=suggest]')!.hidden);
  if (hasSugg) await expect(el(page, '[data-view=suggest]')).toBeVisible();
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('?'); // ? still opens the help dialog on desktop
  await expect(el(page, '.help')).toBeVisible();
});

test('phone: the menu button replaces share, export, letters and help; the menu opens inside the viewport without moving the board', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'phone profiles only');
  const errors = collectErrors(page);
  await open(page);
  await expect(menuBtn(page)).toBeVisible();
  await expect(menuBtn(page)).toHaveAttribute('aria-label', 'Menu');
  await expect(menuBtn(page)).toHaveAttribute('aria-haspopup', 'true');
  await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'false');
  for (const sel of ['[data-share=copy]', '[data-share=export]', '[data-view=suggest]', '[data-view=help]']) await expect(el(page, sel)).toBeHidden();
  await expect(menu(page)).toBeHidden();

  // The intro leaves the word play on the board: clear it first.
  await press(isMobile, el(page, '[data-history=clear]'));
  await press(isMobile, el(page, '[data-history=clear-yes]'));
  await expect(el(page, '[data-history=clear]')).toBeDisabled();

  // Empty board: share and download are shown disabled in the menu, and do nothing.
  await press(isMobile, menuBtn(page));
  await expect(menu(page)).toBeVisible();
  await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'share')).toHaveAttribute('aria-disabled', 'true');
  await expect(item(page, 'download')).toHaveAttribute('aria-disabled', 'true');
  await expect(item(page, 'help')).not.toHaveAttribute('aria-disabled', 'true');
  await item(page, 'download').tap({ force: true }); // aria-disabled: Playwright would wait for it to be "enabled"
  await expect(el(page, '.menu .sub')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  // With a piece selected: opening the menu deselects nothing, moves nothing, and overlaps nothing.
  await addPiece(page, isMobile);
  const before = await snapshot(page);
  await press(isMobile, menuBtn(page));
  await expect(menu(page)).toBeVisible();
  expect(await activeMenuId(page), 'focus moves into the menu').toBe('share');
  const open1 = await snapshot(page);
  expect(open1.camera).toBe(before.camera);
  expect(open1.pieces).toBe(before.pieces);
  await expect(el(page, '.actions')).toBeVisible();
  await expectNoOverlaps(page);
  const lettersShown = await item(page, 'letters').isVisible();
  if (lettersShown) await expect(item(page, 'letters')).toContainText('Letters');
  await expect(item(page, 'share')).toContainText('Copy share link');
  await expect(item(page, 'help')).toContainText('Keyboard shortcuts');
  await expect(item(page, 'share')).not.toHaveAttribute('aria-disabled', 'true');

  // The Download choices open inline and stay inside the viewport.
  await press(isMobile, item(page, 'download'));
  await expect(item(page, 'png')).toBeVisible();
  await expect(item(page, 'svg')).toBeVisible();
  await expectNoOverlaps(page);
  await page.screenshot({ path: `.playwright-mcp/menu-download-${info.project.name}.png` });
  expect(errors, 'console errors').toEqual([]);
});

test('phone: each menu item does what the original button did', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await addPiece(page, isMobile);
  // No native share sheet in the test: downloads take the plain-download path.
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));

  // Copy share link: the clipboard write succeeds -> "Link copied" and the menu closes, focus back on the menu button.
  await page.evaluate(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (window as unknown as { __copied: string[] }).__copied.push(t) }, configurable: true });
  });
  await press(isMobile, menuBtn(page));
  await press(isMobile, item(page, 'share'));
  await expect(menu(page)).toBeHidden();
  await expect(el(page, '.notice .msg')).toHaveText('Link copied');
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]), 'the share link was copied').toContain('#c=');

  // ...and when copying is blocked, the selectable fallback field appears.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true }));
  await press(isMobile, menuBtn(page));
  await press(isMobile, item(page, 'share'));
  await expect(el(page, '.linkbox')).toBeVisible();
  await expect(el(page, '.linkbox input')).toHaveValue(/#c=/);
  await press(isMobile, el(page, '[data-share=close]'));
  await expect(el(page, '.linkbox')).toBeHidden();

  // Download offers PNG and SVG, and a download happens (the menu closes).
  for (const kind of ['svg', 'png'] as const) {
    await press(isMobile, menuBtn(page));
    await press(isMobile, item(page, 'download'));
    await expect(item(page, 'png')).toBeVisible();
    await expect(item(page, 'svg')).toBeVisible();
    const dl = page.waitForEvent('download');
    await press(isMobile, item(page, kind));
    expect((await dl).suggestedFilename()).toMatch(new RegExp(`\\.${kind}$`));
    await expect(menu(page)).toBeHidden();
  }

  // Letters opens the suggestions sheet (the item exists while there are suggestions).
  await expect(menuBtn(page)).toBeVisible();
  await press(isMobile, menuBtn(page));
  await expect(item(page, 'letters')).toBeVisible();
  await press(isMobile, item(page, 'letters'));
  await expect(menu(page)).toBeHidden();
  await expect(el(page, '.sugg')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.sugg')).toBeHidden();
  expect(await activeMenuId(page), 'focus returns to the menu button').toBe('menu');

  // Keyboard shortcuts opens the dialog; closing it returns focus to the menu button.
  await press(isMobile, menuBtn(page));
  await press(isMobile, item(page, 'help'));
  await expect(menu(page)).toBeHidden();
  await expect(el(page, '.help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.help')).toBeHidden();
  expect(await activeMenuId(page)).toBe('menu');
});

test('phone: Escape, an outside tap and the button itself close the menu; arrow keys, Home and End move between items', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await addPiece(page, isMobile);

  await press(isMobile, menuBtn(page));
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  expect(await activeMenuId(page), 'Escape returns focus to the menu button').toBe('menu');

  await press(isMobile, menuBtn(page));
  await expect(menu(page)).toBeVisible();
  await press(isMobile, menuBtn(page));
  await expect(menu(page)).toBeHidden();

  await press(isMobile, menuBtn(page));
  await expect(menu(page)).toBeVisible();
  const vp = page.viewportSize()!;
  await page.touchscreen.tap(Math.round(vp.width * 0.12), Math.round(vp.height * 0.4)); // empty board, away from the menu
  await expect(menu(page)).toBeHidden();

  // Menu keyboard support.
  await press(isMobile, menuBtn(page));
  const ids = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.menu [role=menuitem]')].filter((i) => i.offsetParent !== null).map((i) => i.dataset.menu!));
  expect(await activeMenuId(page)).toBe(ids[0]);
  await page.keyboard.press('ArrowDown');
  expect(await activeMenuId(page)).toBe(ids[1]);
  await page.keyboard.press('End');
  expect(await activeMenuId(page)).toBe(ids[ids.length - 1]);
  await page.keyboard.press('ArrowDown');
  expect(await activeMenuId(page), 'wraps to the first').toBe(ids[0]);
  await page.keyboard.press('ArrowUp');
  expect(await activeMenuId(page), 'wraps to the last').toBe(ids[ids.length - 1]);
  await page.keyboard.press('Home');
  expect(await activeMenuId(page)).toBe(ids[0]);
  await page.keyboard.press('ArrowDown'); // Download
  await page.keyboard.press('Enter');
  await expect(item(page, 'png')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
});

test('phone: the C, E, L and ? shortcuts keep working', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await addPiece(page, isMobile);
  await page.evaluate(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (window as unknown as { __copied: string[] }).__copied.push(t) }, configurable: true });
  });
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('c');
  await expect(el(page, '.notice .msg')).toHaveText('Link copied');

  await page.keyboard.press('e'); // the export choices live in the menu on phones
  await expect(menu(page)).toBeVisible();
  await expect(item(page, 'png')).toBeVisible();
  expect(await activeMenuId(page)).toBe('png');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  await page.keyboard.press('l');
  await expect(el(page, '.sugg')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.sugg')).toBeHidden();

  await page.keyboard.press('?');
  await expect(el(page, '.help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(el(page, '.help')).toBeHidden();
});

test('axe: no violations with the menu open on the phone profile', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'axe gate runs in Chromium, on the phone profiles');
  await open(page);
  await addPiece(page, isMobile);
  await press(isMobile, menuBtn(page));
  await press(isMobile, item(page, 'download'));
  await expect(menu(page)).toBeVisible();
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const violations = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(violations).toEqual([]);
});
