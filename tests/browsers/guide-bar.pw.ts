import { expect, test, type Locator, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * v1.6.3: the guide bar ([Back] [Next] · step count · [Exit]) on the instruction steps, the callout with the instruction
 * alone, Back (undo until the guide is one step back, never past where it started), and the turning lesson (a pulsing
 * blueprint-blue ring on the rotate handle, no dashed selection box), in Chromium AND WebKit, desktop, phone portrait and
 * phone landscape. Screenshots go to FF_SHOTS (default .playwright-mcp) as v163-<project>-<step>.png.
 */

test.use({ storageState: { cookies: [], origins: [] } });

type P = { id: string; shapeId: string; x: number; y: number; rotation: number };
type O = { shapeId: string; x: number; y: number; rotation: number };
type FF = HTMLElement & {
  getView(): { x: number; y: number; zoom: number };
  composition: { pieces: P[] };
  guide: { step: number; phase: string | null; outlines: O[]; filled: (string | null)[]; done: boolean[]; turn: string | null };
  selection: string[];
};

const SHOTS = process.env.FF_SHOTS || '.playwright-mcp';
const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const bar = (page: Page) => el(page, '.gbar');
const bbtn = (page: Page, id: 'back' | 'next' | 'exit') => el(page, `.gbar [data-gbar=${id}]`);
const count = (page: Page) => el(page, '.gbar .gcount');
const press = (isMobile: boolean, l: Locator) => (isMobile ? l.tap() : l.click());
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = (page: Page) => page.evaluate(() => {
  const ff = document.querySelector('fridge-face') as FF;
  const g = ff.guide;
  return { step: g.step, phase: g.phase, turn: g.turn, filled: [...g.filled], done: g.done.filter(Boolean).length, outlines: g.outlines.map((o) => ({ ...o })), pieces: ff.composition.pieces.map((p) => ({ ...p })), selection: [...ff.selection] };
});

async function ready(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
}

/** A blank board: the welcome question, Yes, step 1a. */
async function open(page: Page, url = '/?n=bar') {
  await page.goto(url);
  await ready(page);
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  await expect(bar(page), 'no bar on the welcome question').toBeHidden();
  await el(page, '.guide [data-guide=yes]').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
  await expect(bar(page)).toBeVisible();
}

async function historyKey(page: Page, kind: 'undo' | 'redo') {
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press(kind === 'undo' ? 'Control+z' : 'Control+Shift+z');
}

/** Drag the wedge from the tray onto its LANDING outline (rotation 0): it clicks into position only (step 1b). */
async function wedgeToLanding(page: Page) {
  await frames(page);
  const s = await state(page);
  const o = s.outlines.find((q) => q.shapeId === 'wedge')!;
  const to = await page.evaluate((o) => {
    const ff = document.querySelector('fridge-face') as FF;
    const board = ff.shadowRoot!.querySelector('.board')!;
    const b = board.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(board).getPropertyValue('--k'));
    const v = ff.getView();
    return { x: b.left + (o.x * v.zoom + v.x) * k, y: b.top + (o.y * v.zoom + v.y) * k };
  }, o);
  const t = await el(page, '.tray button[data-shape="wedge"]').boundingBox();
  const a = { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((to.x + 3 - a.x) * i) / 12, a.y + ((to.y - 2 - a.y) * i) / 12);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).turn, 'clicked into position, waiting to be turned').not.toBeNull();
  await page.waitForTimeout(260); // the settle
  await frames(page);
}

/** The bar's place: clear of every control, the tray and the callout; phones: the 8 px gutters / the top row. */
async function checkBar(page: Page, label: string, project: string) {
  await frames(page);
  const m = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const r = (e: Element | null) => {
      if (!e || (e as HTMLElement).hidden) return null;
      const b = e.getBoundingClientRect();
      return b.width && b.height && getComputedStyle(e).display !== 'none' ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
    };
    return {
      bar: r(sr.querySelector('.gbar'))!, board: r(sr.querySelector('.board'))!, tray: r(sr.querySelector('.tray'))!, guide: r(sr.querySelector('.guide')),
      view: r(sr.querySelector('.dock > .view')), vmenu: r(sr.querySelector('.dock > .vmenu')),
      panels: [...sr.querySelectorAll('.dock > .panel')].map((e) => ({ name: e.className, r: r(e) })).filter((p) => p.r),
      buttons: [...sr.querySelectorAll('.gbar button')].map((b) => b.getBoundingClientRect().height),
      side: (sr.querySelector('.guide') as HTMLElement).dataset.side, noarrow: sr.querySelector('.guide')!.hasAttribute('data-noarrow'),
      target: (() => {
        const g = sr.querySelector<HTMLElement>('.guide')!;
        const k = g.dataset.target;
        const e = k === 'tray' ? (g.dataset.shape ? sr.querySelector(`.tray button[data-shape="${g.dataset.shape}"]`) : sr.querySelector('.tray'))
          : k === 'handle' ? sr.querySelector('[data-handle] circle') : k === 'piece' ? sr.querySelector(`[data-piece-id="${g.dataset.piece}"] .bd`)
            : k === 'action' ? sr.querySelector(`.block [data-block=${g.dataset.action}]`) : null;
        const tr = r(e);
        // A tray shape's target is its slice of the tray (its column across the tray's height; its row in the landscape column).
        if (k === 'tray' && g.dataset.shape && tr) {
          const tray = r(sr.querySelector('.tray'))!;
          return sr.querySelector('.root')!.hasAttribute('data-landscape') ? { x: tray.x, y: tr.y, w: tray.w, h: tr.h } : { x: tr.x, y: tray.y, w: tr.w, h: tray.h };
        }
        return tr;
      })(),
      portrait: (() => { const q = sr.querySelector('.root')!; return q.hasAttribute('data-compact') && !q.hasAttribute('data-landscape'); })(),
      // What the turning step is about, besides the handle: the piece to turn and its outline.
      about: (() => {
        const ff = document.querySelector('fridge-face') as unknown as { guide: { turn: string | null } };
        const t = ff.guide.turn;
        return t ? [r(sr.querySelector(`[data-piece-id="${t}"] .bd`)), ...[...sr.querySelectorAll('[data-outline]')].map((e) => r(e))].filter(Boolean) : [];
      })(),
    };
  });
  type R = { x: number; y: number; w: number; h: number };
  const ov = (a: R | null, b: R | null) => !!a && !!b && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const b = m.bar;
  for (const p of m.panels) expect.soft(ov(b, p.r), `${label}: the bar overlaps ${p.name}`).toBe(false);
  expect.soft(ov(b, m.tray), `${label}: the bar overlaps the tray`).toBe(false);
  expect.soft(ov(b, m.guide), `${label}: the callout overlaps the bar`).toBe(false);
  // The callout: on a control only when it points at its target from close by (arrow showing); never on the portrait top row.
  if (m.guide) {
    const c = m.guide, t = m.target;
    const reach = !t || m.side === 'centre' ? Infinity : m.side === 'above' ? t.y - (c.y + c.h) : m.side === 'below' ? c.y - (t.y + t.h) : m.side === 'right' ? c.x - (t.x + t.w) : t.x - (c.x + c.w);
    for (const p of m.panels) {
      if (!ov(c, p.r)) continue;
      expect.soft(!!t && m.side !== 'centre' && !m.noarrow && reach <= 31, `${label}: the callout covers ${p.name} without pointing at its target from close by (side ${m.side}, reach ${reach})`).toBe(true);
      if (m.portrait) expect.soft(/\b(view|vmenu)\b/.test(p.name), `${label}: the callout covers the portrait top row`).toBe(false);
    }
    // (In the word on phones the button block stands between the callout and the tray it points at: the callout keeps clear
    // of the block there, so it stands just beyond it.)
    const blk = m.panels.find((p) => p.name.includes('block'))?.r;
    const across = !!blk && !!t && m.side === 'above' && blk.y >= c.y + c.h - 0.5 && blk.y + blk.h <= t.y + 0.5 ? blk.h : 0;
    // The turning step: beside the piece or its outline counts as by its target (the arrow still points at the handle).
    const gap = (a: R, b: R) => Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h), b.x - (a.x + a.w), a.x - (b.x + b.w));
    const near = Math.min(reach - across, ...(m.about as R[]).map((q) => gap(c, q)));
    if (t && m.side !== 'centre') expect.soft(near, `${label}: the callout stands by its target (${m.side}, ${JSON.stringify(t)} ${JSON.stringify(c)})`).toBeLessThanOrEqual(60);
  }
  for (const h of m.buttons) expect.soft(h, `${label}: a bar button is at least 44px tall`).toBeGreaterThanOrEqual(44);
  expect.soft(b.h, `${label}: a slim bar`).toBeLessThanOrEqual(48.5);
  if (project.endsWith('iphone')) {
    expect.soft(Math.round(b.x - m.board.x), `${label}: 8px gutter (left)`).toBe(8);
    expect.soft(Math.round(m.board.x + m.board.w - (b.x + b.w)), `${label}: 8px gutter (right)`).toBe(8);
    expect.soft(b.y >= m.view!.y + m.view!.h, `${label}: under the top controls row`).toBe(true);
  } else if (project.endsWith('landscape')) {
    expect.soft(b.x >= m.view!.x + m.view!.w && b.x + b.w <= m.vmenu!.x, `${label}: between the zoom group and the menu button`).toBe(true);
    expect.soft(b.y < m.view!.y + m.view!.h, `${label}: in the top row`).toBe(true);
  } else {
    expect.soft(b.y - m.board.y, `${label}: at the top of the board`).toBeLessThan(20);
    expect.soft(Math.abs(b.x + b.w / 2 - (m.board.x + m.board.w / 2)), `${label}: centred`).toBeLessThan(2);
  }
}

/** The turning lesson's ring and box: present / absent. */
const lesson = (page: Page) => page.evaluate(() => {
  const sr = document.querySelector('fridge-face')!.shadowRoot!;
  const ring = sr.querySelector<SVGElement>('[data-handle] [data-pulse]');
  const box = sr.querySelector('[data-selection-box]');
  return {
    ring: !!ring, ringPE: ring ? getComputedStyle(ring).pointerEvents : null, ringStroke: ring?.getAttribute('stroke') ?? null,
    anim: ring ? getComputedStyle(ring).animationName : null, opacity: ring ? getComputedStyle(ring).opacity : null,
    boxRect: !!box?.querySelector('rect'), handle: !!sr.querySelector('[data-handle]'), stem: !!box?.querySelector('line'),
    firstCircleIsHit: sr.querySelector('[data-handle] circle')?.getAttribute('fill') === 'transparent',
  };
});

test('the c: the bar per step (Step N of 4), the callout with no buttons, Back step by step (disabled at 1a), Redo, the pulsing handle on 1b only; screenshots', async ({ page, isMobile }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = (n: string) => page.screenshot({ path: `${SHOTS}/v163-${info.project.name}-${n}.png` });
  await open(page);
  await expect(bar(page)).toHaveAttribute('role', 'toolbar');
  await expect(bar(page)).toHaveAttribute('aria-label', 'Guide');
  await expect(bbtn(page, 'back')).toHaveAccessibleName('Back');
  await expect(bbtn(page, 'next')).toHaveAccessibleName('Next');
  await expect(bbtn(page, 'exit')).toHaveAccessibleName('Exit guide');
  await expect(count(page)).toHaveText('Step 1 of 4');
  await expect(el(page, '.guide button:visible'), 'the callout shows only the instruction').toHaveCount(0);
  await expect(bbtn(page, 'back'), 'nothing to go back to at 1a').toHaveAttribute('aria-disabled', 'true');
  // The three buttons share one style: transparent, white edge and text (Next is not filled).
  const looks = await page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('.gbar [data-gbar=next], .gbar [data-gbar=exit]')].map((b) => {
    const c = getComputedStyle(b);
    return [c.backgroundColor, c.color, c.borderTopColor, c.textTransform].join('|');
  }));
  expect(looks).toEqual(['rgba(0, 0, 0, 0)|rgb(255, 255, 255)|rgb(255, 255, 255)|uppercase', 'rgba(0, 0, 0, 0)|rgb(255, 255, 255)|rgb(255, 255, 255)|uppercase']);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('fridge-face')!.shadowRoot!.querySelector('.gbar')!).backgroundColor)).toBe('rgb(0, 0, 0)');
  await checkBar(page, '1a', info.project.name);
  expect((await lesson(page)).ring, 'no ring at 1a').toBe(false);
  await shot('1a');
  // Back at 1a does nothing.
  await bbtn(page, 'back').dispatchEvent('click'); // (aria-disabled: Playwright will not press it)
  expect((await state(page)).pieces).toHaveLength(0);

  // 1b: the wedge in position, to be turned: still Step 1 of 4; the ring pulses on its handle; no dashed box.
  await wedgeToLanding(page);
  await expect(count(page)).toHaveText('Step 1 of 4');
  await expect(el(page, '.guide button:visible')).toHaveCount(0);
  let l = await lesson(page);
  expect(l, '1b: ring on the handle, no selection box, stem and handle kept').toMatchObject({ ring: true, ringPE: 'none', ringStroke: '#378ADD', anim: 'ff-pulse', boxRect: false, handle: true, stem: true, firstCircleIsHit: true });
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'false');
  await checkBar(page, '1b', info.project.name);
  await shot('1b');
  // Back from 1b: the wedge's drop (and its click-in, the same undo step) is undone: 1a, Back disabled again. Redo: 1b.
  await press(isMobile, bbtn(page, 'back'));
  await expect.poll(async () => (await state(page)).pieces.length).toBe(0);
  expect((await state(page)).turn).toBeNull();
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'true');
  expect((await lesson(page)).ring).toBe(false);
  await historyKey(page, 'redo');
  await expect.poll(async () => (await state(page)).turn).not.toBeNull();

  // Next fills the wedge (step 2); Back undoes its completing action: 1b again (the wedge at its landing angle, selected, the ring back).
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await expect(count(page)).toHaveText('Step 2 of 4');
  expect((await lesson(page)).ring, 'no ring once the wedge is in').toBe(false);
  await press(isMobile, bbtn(page, 'back'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  let s = await state(page);
  expect(s.turn, 'back to 1b').not.toBeNull();
  expect(s.pieces.map((p) => p.shapeId)).toEqual(['wedge']);
  expect(s.selection).toEqual([s.turn]);
  expect((await lesson(page)).ring).toBe(true);
  await historyKey(page, 'redo');
  await expect(guide(page)).toHaveAttribute('data-step', '2');

  // Step 3 and back to 2 (the black oval goes), Next again, step 4 (bring forward).
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await expect(count(page)).toHaveText('Step 3 of 4');
  await press(isMobile, bbtn(page, 'back'));
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  expect((await state(page)).pieces.map((p) => p.shapeId)).toEqual(['wedge']);
  await press(isMobile, bbtn(page, 'next'));
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await expect(count(page)).toHaveText('Step 4 of 4');
  l = await lesson(page);
  expect(l.ring, 'no ring at step 4').toBe(false);
  s = await state(page);
  expect(s.selection, 'Next\'s white oval brought the lesson: the wedge is selected for Forward').toEqual([s.filled[s.outlines.findIndex((o) => o.shapeId === 'wedge')]]);
  expect(l.boxRect, 'the selected wedge keeps its dashed box outside the lesson').toBe(true);
  await checkBar(page, '4', info.project.name);
  await shot('4');
  await press(isMobile, bbtn(page, 'back'));
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  // Next into step 5 (a question): the bar hides; the question keeps its own buttons.
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await expect(bar(page)).toBeHidden();
  await expect(el(page, '.guide [data-guide=word]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the word: "N of M" in the bar, Back undoes the last placement (never below Guide me), Next and Exit', async ({ page, isMobile }, info) => {
  test.setTimeout(90_000);
  await open(page, '/?n=barword');
  for (let i = 0; i < 4; i++) await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await press(isMobile, el(page, '.guide [data-guide=word]'));
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await expect(bar(page)).toBeVisible();
  await expect(count(page)).toHaveText('3 of 32');
  await expect(el(page, '.guide .gt2'), 'the progress left the callout').toBeHidden();
  await expect(el(page, '.guide button:visible')).toHaveCount(0);
  await expect(bbtn(page, 'back'), 'Back never undoes the c built before Guide me').toHaveAttribute('aria-disabled', 'true');
  await press(isMobile, bbtn(page, 'next'));
  await expect(count(page)).toHaveText('4 of 32');
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'false');
  await press(isMobile, bbtn(page, 'back'));
  await expect(count(page)).toHaveText('3 of 32');
  expect((await state(page)).pieces).toHaveLength(3);
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'true');
  await historyKey(page, 'redo');
  await expect(count(page)).toHaveText('4 of 32');
  await press(isMobile, bbtn(page, 'next'));
  await expect(count(page)).toHaveText('5 of 32');
  await page.waitForFunction(() => {
    const f = document.querySelector('fridge-face') as unknown as { viewGlide: number; wordFitPending: unknown };
    return !f.viewGlide && !f.wordFitPending;
  });
  await frames(page);
  await checkBar(page, 'word', info.project.name);
  await page.screenshot({ path: `${SHOTS}/v163-${info.project.name}-6-word.png` });
  await press(isMobile, bbtn(page, 'exit'));
  await expect(guide(page)).toBeHidden();
  await expect(bar(page)).toBeHidden();
  expect((await state(page)).pieces, 'Exit keeps the pieces').toHaveLength(5);
});

test('Back never undoes the visitor\'s own pieces or step 0\'s Clear and start', async ({ page, isMobile }) => {
  await page.goto('/?n=barask');
  await ready(page);
  await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { loadComposition(d: unknown): unknown }).loadComposition({ v: 1, pieces: [{ s: 'positive-stem', x: 0, y: 0, r: 0 }] }));
  await expect(guide(page)).toHaveAttribute('data-ask', '', { timeout: 5000 });
  await expect(bar(page), 'no bar on the question').toBeHidden();
  await press(isMobile, el(page, '.guide [data-guide=clean]'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'true');
  await press(isMobile, bbtn(page, 'next'));
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  await press(isMobile, bbtn(page, 'back'));
  await expect(guide(page)).toHaveAttribute('data-step', '1');
  await expect(bbtn(page, 'back')).toHaveAttribute('aria-disabled', 'true');
  await bbtn(page, 'back').dispatchEvent('click');
  expect((await state(page)).pieces, 'the clear stays: their stem is not back').toHaveLength(0);
});

test('reduced motion: the ring on the handle is steady (not animated)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/?n=barrm');
  await wedgeToLanding(page);
  const l = await lesson(page);
  expect(l).toMatchObject({ ring: true, anim: 'none', opacity: '1', boxRect: false });
});
