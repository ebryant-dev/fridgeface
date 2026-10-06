import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * v1.5.0: ONE bottom button block on phones and desktop, left to right X, Undo, Redo, Back (down arrow), Forward (up arrow),
 * always visible, icons everywhere (each with a tooltip and a screen-reader label). X deletes the selection, or with nothing
 * selected asks to clear the board (the inline confirm). The separate selection action bar, Clear and Delete are gone.
 * Chromium and WebKit; desktop, iPhone portrait and iPhone landscape.
 */

type P = { s: string; x: number; y: number; r: number };
type R = { x: number; y: number; width: number; height: number };
const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = { 'chromium-desktop': 'desktop', 'webkit-iphone': 'wk-iphone', 'webkit-iphone-landscape': 'wk-iphone-landscape' };

/** A black oval with a white one on top of it (they overlap), and a stem apart. */
const SCENE: P[] = [
  { s: 'positive-round', x: 0, y: 0, r: 0 },
  { s: 'negative-round', x: 30, y: 0, r: 0 },
  { s: 'positive-stem', x: 330, y: 0, r: 0 },
];

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const btn = (page: Page, id: string) => el(page, `.block [data-block=${id}]`);
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const ids = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as unknown as { composition: { pieces: { id: string }[] } }).composition.pieces.map((p) => p.id));
const setSel = (page: Page, which: number[]) =>
  page.evaluate((which) => {
    const ff = document.querySelector('fridge-face') as unknown as { composition: { pieces: { id: string }[] }; setSelection(ids: string[]): void };
    ff.setSelection(which.map((i) => ff.composition.pieces[i].id));
  }, which);

async function open(page: Page) {
  await page.goto('/?n=block');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function load(page: Page, pieces: P[] = SCENE) {
  await page.evaluate((pieces) => (document.querySelector('fridge-face') as unknown as { loadComposition(d: unknown): unknown }).loadComposition({ v: 1, pieces }), pieces);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
}

/** Everything that must not overlap: the block, the dock panels, the tray, the menu, the callout, the notice, the credit. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const rect = (e: Element) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number };
    const shown = (e: Element) => {
      const h = e as HTMLElement, cs = getComputedStyle(h);
      return !h.hidden && !h.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && h.getBoundingClientRect().width > 0;
    };
    const out: { name: string; r: { x: number; y: number; width: number; height: number } }[] = [];
    const add = (name: string, sel: string, root: ParentNode = sr) => {
      for (const e of root.querySelectorAll(sel)) if (shown(e)) out.push({ name, r: rect(e) });
    };
    add('tray', '.tray');
    for (const p of sr.querySelectorAll('.dock > .panel')) if (shown(p)) out.push({ name: (p as HTMLElement).className, r: rect(p) });
    add('notice', '.dock > .notice .msg');
    add('menu', '.menu');
    add('guide', '.guide');
    add('credit', '.credit', document);
    return { boxes: out, vw: window.innerWidth, vh: window.innerHeight };
  });
}

async function expectClean(page: Page, label: string) {
  const s = await boxes(page);
  const ov = (a: R, b: R) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
  expect.soft(s.boxes.some((b) => b.name.includes('block')), `${label}: the block shows`).toBe(true);
  for (let i = 0; i < s.boxes.length; i++) {
    const b = s.boxes[i];
    expect.soft(b.r.x >= -0.5 && b.r.y >= -0.5 && b.r.x + b.r.width <= s.vw + 0.5 && b.r.y + b.r.height <= s.vh + 0.5, `${label}: ${b.name} inside the viewport`).toBe(true);
    for (let j = i + 1; j < s.boxes.length; j++) {
      const c = s.boxes[j];
      if (b.name === 'tray' && c.name === 'credit') continue; // the standalone page's credit sits in the tray band by design
      expect.soft(ov(b.r, c.r), `${label}: ${b.name} ${JSON.stringify(b.r)} overlaps ${c.name} ${JSON.stringify(c.r)}`).toBe(false);
    }
  }
  return s;
}

async function axe(page: Page) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  return page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
  });
}

test('the block: X, Undo, Redo, Back, Forward left to right, icons with tooltips and labels, always visible; the old bar and buttons are gone', async ({ page, isMobile }, info) => {
  await open(page);
  await load(page);
  const nm = NAMES[info.project.name];
  // Nothing selected.
  const read = () => page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    return [...sr.querySelectorAll<HTMLButtonElement>('.block .main button')].map((b) => {
      const r = b.getBoundingClientRect();
      const ic = b.querySelector('.ic');
      return {
        id: b.dataset.block, label: b.getAttribute('aria-label'), title: b.title, disabled: b.disabled, x: r.x, y: r.y,
        icon: !!ic && getComputedStyle(ic).display !== 'none', text: getComputedStyle(b.querySelector('.tx')!).display !== 'none', svg: ic?.innerHTML ?? '',
      };
    });
  });
  let b = await read();
  expect(b.map((x) => x.id)).toEqual(['x', 'undo', 'redo', 'backward', 'forward']);
  for (let i = 1; i < b.length; i++) {
    expect(b[i].x, `${b[i].id} right of ${b[i - 1].id}`).toBeGreaterThan(b[i - 1].x);
    expect(Math.abs(b[i].y - b[0].y), 'one row').toBeLessThan(1);
  }
  for (const x of b) {
    expect(x.icon, `${x.id}: icon`).toBe(true);
    expect(x.text, `${x.id}: no text label shown`).toBe(false);
    expect(x.title, `${x.id}: tooltip = label`).toBe(x.label);
  }
  expect(b.map((x) => x.label)).toEqual(['Clear board', 'Undo', 'Redo', 'Send backward', 'Bring forward']);
  // Icons: the X is the clear icon (a square with a cross), Back a DOWN arrow, Forward an UP arrow.
  expect(b[0].svg).toContain('<rect');
  expect(b[3].svg).toContain('M12 3v17M5 13l7 7 7-7');
  expect(b[4].svg).toContain('M12 21V4M5 11l7-7 7 7');
  expect(b.map((x) => x.disabled), 'no selection: X on (pieces on the board), Back and Forward off').toEqual([false, false, true, true, true]);
  await expect(el(page, '.actions, .history, [data-action], [data-history]')).toHaveCount(0);
  if (isMobile) { await expect(el(page, '.dock > .view')).toBeVisible(); await expect(el(page, '.dock > .vmenu')).toBeVisible(); } // the top shows the zoom/fit group (left) and the menu button (right)
  await expectClean(page, 'no selection');
  if (nm === 'desktop') await page.screenshot({ path: `${SHOT}/v150-block-desktop-noselect.png` });

  // The white oval selected: X deletes it; Back is on (the black oval is below it), Forward off (nothing above overlaps).
  await setSel(page, [1]);
  b = await read();
  expect(b.map((x) => [x.label, x.disabled])).toEqual([['Delete piece', false], ['Undo', false], ['Redo', true], ['Send backward', false], ['Bring forward', true]]);
  await expectClean(page, 'selected');
  if (nm) await page.screenshot({ path: `${SHOT}/v150-block-${nm}.png` });
  await setSel(page, [0, 1, 2]);
  await expect(btn(page, 'x')).toHaveAttribute('aria-label', 'Delete 3 pieces');
  await expect(btn(page, 'x')).toHaveAttribute('title', 'Delete 3 pieces');
});

test('X deletes the selection (one piece, then several), each one undo step', async ({ page, isMobile }) => {
  await open(page);
  await load(page);
  const all = await ids(page);
  await setSel(page, [1]);
  await press(isMobile, btn(page, 'x'));
  await expect.poll(() => ids(page)).toEqual([all[0], all[2]]);
  await expect(btn(page, 'x'), 'nothing selected now: X clears the board').toHaveAttribute('aria-label', 'Clear board');
  await press(isMobile, btn(page, 'undo'));
  await expect.poll(() => ids(page)).toEqual(all);
  await setSel(page, [0, 2]);
  await press(isMobile, btn(page, 'x'));
  await expect.poll(() => ids(page)).toEqual([all[1]]);
  await press(isMobile, btn(page, 'undo'));
  await expect.poll(() => ids(page), 'one undo restores the whole multi-selection').toEqual(all);
});

test('X with nothing selected asks first: Cancel keeps the board, Clear clears it as one undo step; Escape cancels; disabled on an empty board', async ({ page, isMobile }, info) => {
  await open(page);
  await load(page);
  const all = await ids(page);
  await press(isMobile, btn(page, 'x'));
  await expect(el(page, '.block .confirm')).toBeVisible();
  await expect(el(page, '.block .confirm')).toHaveAttribute('role', 'alertdialog');
  await expect(el(page, '.block .main button').first()).toBeHidden();
  await expect(el(page, '[data-block=clear-no]')).toBeFocused();
  await expectClean(page, 'clear-confirm');
  if (NAMES[info.project.name] === 'desktop') await page.screenshot({ path: `${SHOT}/v150-clear-confirm-desktop.png` });
  if (info.project.use.browserName === 'chromium') expect(await axe(page), 'axe with the clear-confirm open').toEqual([]);
  await press(isMobile, el(page, '[data-block=clear-no]'));
  await expect(el(page, '.block .confirm')).toBeHidden();
  expect(await ids(page), 'Cancel keeps everything').toEqual(all);
  await expect(btn(page, 'x')).toBeFocused();
  // Escape cancels too.
  await press(isMobile, btn(page, 'x'));
  await page.keyboard.press('Escape');
  await expect(el(page, '.block .confirm')).toBeHidden();
  expect(await ids(page)).toEqual(all);
  // Confirm clears, one undo restores.
  await press(isMobile, btn(page, 'x'));
  await press(isMobile, el(page, '[data-block=clear-yes]'));
  await expect.poll(() => ids(page)).toEqual([]);
  await expect(btn(page, 'x'), 'empty board, nothing selected: X is off').toBeDisabled();
  await press(isMobile, btn(page, 'undo'));
  await expect.poll(() => ids(page), 'one undo restores the board').toEqual(all);
});

test('Back (down arrow) and Forward (up arrow) restack, overlap-aware; disabled when nothing is selected or the press would do nothing', async ({ page, isMobile }) => {
  await open(page);
  await load(page);
  const [black, white, stem] = await ids(page);
  await expect(btn(page, 'backward')).toBeDisabled();
  await expect(btn(page, 'forward')).toBeDisabled();
  await setSel(page, [1]); // the white oval, on top of the black one
  await expect(btn(page, 'forward')).toBeDisabled();
  await press(isMobile, btn(page, 'backward'));
  await expect.poll(() => ids(page)).toEqual([white, black, stem]);
  await expect(btn(page, 'backward'), 'nothing below it overlaps it now').toBeDisabled();
  await expect(btn(page, 'forward')).toBeEnabled();
  await press(isMobile, btn(page, 'forward'));
  await expect.poll(() => ids(page), 'forward passes the black oval it overlaps').toEqual([black, white, stem]);
  // The stem overlaps nothing: both are off for it.
  await setSel(page, [2]);
  await expect(btn(page, 'backward')).toBeDisabled();
  await expect(btn(page, 'forward')).toBeDisabled();
  // One undo per press.
  await press(isMobile, btn(page, 'undo'));
  await expect.poll(() => ids(page)).toEqual([white, black, stem]);
  // The keyboard shortcuts are unchanged: [ and ] and Delete.
  await setSel(page, [0]); // the white oval, now at the bottom
  await page.locator('fridge-face .board svg.surface').focus();
  await page.keyboard.press(']');
  await expect.poll(() => ids(page)).toEqual([black, white, stem]);
  await page.keyboard.press('[');
  await expect.poll(() => ids(page)).toEqual([white, black, stem]);
  await page.keyboard.press('Delete');
  await expect.poll(() => ids(page)).toEqual([black, stem]);
});

test('Tab order: the block\'s buttons in order, left to right (desktop: then Share and Export)', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile, 'keyboard Tab order on desktop');
  test.skip(browserName === 'webkit', 'Safari does not Tab to buttons by default (its "Press Tab to highlight" setting)');
  await open(page);
  await load(page);
  await setSel(page, [1]);
  await btn(page, 'x').focus();
  const seq: string[] = [];
  for (let i = 0; i < 5; i++) {
    seq.push(await page.evaluate(() => {
      const a = document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null;
      return a?.dataset.block ?? a?.dataset.share ?? a?.dataset.view ?? '?';
    }));
    await page.keyboard.press('Tab');
  }
  // Redo is off (nothing to redo) and Forward is off (nothing above overlaps): disabled buttons are skipped.
  expect(seq).toEqual(['x', 'undo', 'backward', 'copy', 'export']);
});

test('no overlaps with the menu open (phones): it opens downward and stops above the block', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones');
  await open(page);
  await load(page);
  await setSel(page, [1]);
  await el(page, '[data-view=menu]').tap();
  await expect(el(page, '.menu')).toBeVisible();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // the callout hides while the menu is open
  await expectClean(page, 'menu open');
  await page.keyboard.press('Escape');
});

test('axe: 0 violations, with and without a selection (desktop and phone)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await open(page);
  await load(page);
  expect(await axe(page), 'no selection').toEqual([]);
  await setSel(page, [0, 1]);
  expect(await axe(page), 'with a selection').toEqual([]);
});
