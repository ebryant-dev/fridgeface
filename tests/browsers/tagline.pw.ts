import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * v1.6.7: the tagline "Five shapes. Infinite possibilities." stands on the board directly above the welcome question
 * ("Would you like a tutorial?"), centred on the callout, whose text and buttons are centred too. Nowhere else.
 * Chromium AND WebKit, desktop, phone portrait, phone landscape. Screenshots: FF_SHOTS as v167-<project>.png.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const SHOTS = process.env.FF_SHOTS || '.playwright-mcp';
const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const tag = (page: Page) => el(page, '.guide .gtag');

async function openWelcome(page: Page, url = '/?n=tag') {
  await page.goto(url);
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  await expect(guide(page)).toBeVisible();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

type R = { x: number; y: number; w: number; h: number };
const geometry = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('fridge-face')!.shadowRoot!;
  const rect = (e: Element | null): R | null => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const g = root.querySelector('.guide')!;
  const t = root.querySelector('.gtag') as HTMLElement;
  const lines = [...t.querySelectorAll('span')].map((s) => rect(s)!);
  const text = root.querySelector('.gtext') as HTMLElement;
  const rows = [...g.querySelectorAll('.grow:not([hidden])')].filter((e) => getComputedStyle(e).display !== 'none');
  const buttons = rows.flatMap((r) => [...r.querySelectorAll('button')].filter((b) => !(b as HTMLElement).hidden).map((b) => rect(b)!));
  const controls = [...root.querySelectorAll('.dock > .panel, .dock > .notice .msg, .tray')]
    .filter((e) => !(e as HTMLElement).hidden && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none').map((e) => rect(e)!).filter((r) => r.w > 0 && r.h > 0);
  const cs = getComputedStyle(t);
  return {
    tag: rect(t)!, lines, callout: rect(g)!, board: rect(root.querySelector('.board'))!, controls, buttons, rowsBox: rows.map((r) => rect(r)!),
    textRect: rect(text)!, textAlign: getComputedStyle(text).textAlign, justify: rows.map((r) => getComputedStyle(r).justifyContent),
    font: { weight: cs.fontWeight, size: parseFloat(cs.fontSize), ls: cs.letterSpacing, lh: cs.lineHeight, color: cs.color, tt: cs.textTransform, ev: cs.pointerEvents, bg: cs.backgroundColor, family: cs.fontFamily },
    text: t.innerText, hidden: t.hidden,
  };
});

const overlaps = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the tagline stands above the welcome question, centred on it, inside the board, clear of every control; the question and its buttons are centred', async ({ page }, info) => {
  await openWelcome(page);
  const g = await geometry(page);
  expect(g.hidden).toBe(false);
  expect(g.text.replace(/\s+/g, ' ').trim().toLowerCase()).toBe('five shapes. infinite possibilities.');
  expect(g.lines.length).toBe(2);
  expect(g.lines[0].y + g.lines[0].h, 'two lines, the break after "Five shapes."').toBeLessThanOrEqual(g.lines[1].y + 1);
  // above the callout, 22 to 24 px of air (unless the room was tight, then at least 12)
  const gap = g.callout.y - (g.tag.y + g.tag.h);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(26);
  // centred horizontally on the callout
  expect(Math.abs(g.tag.x + g.tag.w / 2 - (g.callout.x + g.callout.w / 2))).toBeLessThanOrEqual(1.5);
  // inside the board with 16 px gutters
  expect(g.tag.x).toBeGreaterThanOrEqual(g.board.x + 16 - 1);
  expect(g.tag.x + g.tag.w).toBeLessThanOrEqual(g.board.x + g.board.w - 16 + 1);
  expect(g.tag.y).toBeGreaterThanOrEqual(g.board.y);
  // overlaps no control (the whole block: tagline and callout)
  for (const c of g.controls) {
    expect(overlaps(g.tag, c), `tagline over a control ${JSON.stringify(c)}`).toBe(false);
    expect(overlaps(g.callout, c), `callout over a control ${JSON.stringify(c)}`).toBe(false);
  }
  // typography
  expect(g.font.weight).toBe('700');
  expect(g.font.tt).toBe('uppercase');
  expect(g.font.color).toBe('rgb(0, 0, 0)');
  expect(g.font.bg).toBe('rgba(0, 0, 0, 0)');
  expect(g.font.ev).toBe('none');
  expect(g.font.family).toContain('Jost');
  expect(g.font.size).toBeGreaterThanOrEqual(12);
  expect(g.font.size).toBeLessThanOrEqual(28);
  expect(parseFloat(g.font.ls) / g.font.size).toBeCloseTo(0.08, 2);
  // the question and its button row are centred
  expect(g.textAlign).toBe('center');
  for (const j of g.justify) expect(j).toBe('center');
  const first = g.buttons.reduce((m, b) => Math.min(m, b.x), 1e9), last = g.buttons.reduce((m, b) => Math.max(m, b.x + b.w), 0);
  const rowTop = Math.min(...g.buttons.map((b) => b.y));
  const firstRow = g.buttons.filter((b) => Math.abs(b.y - rowTop) < 2);
  const fx = Math.min(...firstRow.map((b) => b.x)), lx = Math.max(...firstRow.map((b) => b.x + b.w));
  expect(first).toBeLessThanOrEqual(last);
  expect(Math.abs((fx + lx) / 2 - (g.callout.x + g.callout.w / 2)), 'first row of buttons centred in the callout').toBeLessThanOrEqual(4);
  await page.screenshot({ path: `${SHOTS}/v167-${info.project.name}.png` });
});

test('the tagline is absent on the clean-fridge question', async ({ page, isMobile }) => {
  await openWelcome(page, '/?n=tag2');
  // The clean-fridge variant: pieces appear while the welcome question shows.
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { loadComposition(d: unknown): unknown }).loadComposition({ v: 1, pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }] }));
  await expect(guide(page)).toHaveAttribute('data-ask', '');
  await expect(el(page, '.guide .gt1')).toHaveText('Start on a clean fridge?');
  await expect(tag(page)).toBeHidden();
  expect(await el(page, '.guide .gtext').evaluate((e) => getComputedStyle(e).textAlign), 'other callouts are left-aligned').not.toBe('center');
});

test('the tagline is gone at step 1 and after Exit; those callouts stay left-aligned', async ({ page, isMobile }) => {
  await openWelcome(page, '/?n=tag3');
  const yes = el(page, '.guide [data-guide=yes]');
  await (isMobile ? yes.dispatchEvent('click') : yes.click());
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(tag(page)).toBeHidden();
  await expect(el(page, '.guide .gtext')).toBeVisible();
  expect(await el(page, '.guide .gtext').evaluate((e) => getComputedStyle(e).textAlign)).not.toBe('center');
  // Exit guide: nothing left on the board.
  await el(page, '.gbar [data-gbar=exit]').dispatchEvent('click');
  await expect(guide(page)).toBeHidden();
  await expect(tag(page)).toBeHidden();
});

test('the tagline fits at 320 x 568 and is announced once (inside the callout, before the question; the live region speaks the question only)', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openWelcome(page, '/?n=tag4');
  const g = await geometry(page);
  expect(g.tag.x).toBeGreaterThanOrEqual(g.board.x + 16 - 1);
  expect(g.tag.x + g.tag.w).toBeLessThanOrEqual(g.board.x + g.board.w - 16 + 1);
  expect(g.lines.length).toBe(2);
  for (const c of g.controls) expect(overlaps(g.tag, c) || overlaps(g.callout, c)).toBe(false);
  const order = await guide(page).evaluate((e) => [...e.children].map((c) => c.className));
  expect(order.indexOf('gtag')).toBeLessThan(order.indexOf('gtext'));
  await expect(el(page, '#ff-live')).not.toContainText('Infinite possibilities');
  await page.screenshot({ path: `${SHOTS}/v167-320x568-${info.project.name}.png` });
});
