import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * v1.6.4: the tray shape the guide asks for wears a pulsing blueprint-blue ring of its own silhouette (c steps 1a, 2, 3 and
 * the word's current batch), none on 1b, 4, 5 or with the guide off, steady under reduced motion; and on 1b the wedge's
 * outline is drawn BEHIND the wedge. Chromium AND WebKit, desktop, phone portrait and phone landscape. Screenshots go to
 * FF_SHOTS (default .playwright-mcp) as v164-<project>-<step>.png, the pulse paused mid-spread.
 */

test.use({ storageState: { cookies: [], origins: [] } });

type P = { id: string; shapeId: string; x: number; y: number; rotation: number };
type O = { shapeId: string; x: number; y: number; rotation: number };
type FF = HTMLElement & {
  getView(): { x: number; y: number; zoom: number };
  composition: { pieces: P[] };
  guide: { step: number; phase: string | null; outlines: O[]; filled: (string | null)[]; turn: string | null };
};

const SHOTS = process.env.FF_SHOTS || '.playwright-mcp';
const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const next = (page: Page) => el(page, '.gbar [data-gbar=next]');
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Which tray buttons show the ring, and how it looks. */
const hints = (page: Page) => page.evaluate(() => {
  const sr = document.querySelector('fridge-face')!.shadowRoot!;
  return [...sr.querySelectorAll<HTMLElement>('.tray button[data-shape]')].filter((b) => {
    const p = b.querySelector('.tpulse');
    return b.hasAttribute('data-hint') && !!p && getComputedStyle(p).display !== 'none';
  }).map((b) => b.dataset.shape!).sort();
});
const look = (page: Page, shape: string) => page.evaluate((shape) => {
  const sr = document.querySelector('fridge-face')!.shadowRoot!;
  const b = sr.querySelector<HTMLElement>(`.tray button[data-shape="${shape}"]`)!;
  const p = b.querySelector<SVGElement>('.tpulse')!;
  const c = getComputedStyle(p);
  return {
    anim: c.animationName, opacity: c.opacity, pe: c.pointerEvents, stroke: p.getAttribute('stroke'), hidden: p.closest('[aria-hidden="true"]') !== null,
    label: b.getAttribute('aria-label'), transform: c.transform,
    // Pressing the middle of the shape still lands on its button.
    hit: (() => { const r = b.getBoundingClientRect(); return sr.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b; })(),
  };
}, shape);

/** Pause every tray ring mid-spread, so a screenshot shows it. */
const pausePulse = (page: Page) => page.evaluate(() => {
  for (const p of document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGElement>('.tpulse')) {
    for (const a of p.getAnimations()) { a.pause(); a.currentTime = 600; }
  }
});
const resumePulse = (page: Page) => page.evaluate(() => {
  for (const p of document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<SVGElement>('.tpulse')) for (const a of p.getAnimations()) a.play();
});

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  expect(await hints(page), 'none on the welcome question').toEqual([]);
  await el(page, '.guide [data-guide=yes]').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
}

/** Drag the wedge from the tray onto its landing outline: it clicks into position only (1b). */
async function wedgeToLanding(page: Page) {
  await frames(page);
  const to = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    const o = ff.guide.outlines.find((q) => q.shapeId === 'wedge')!;
    const board = ff.shadowRoot!.querySelector('.board')!;
    const b = board.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(board).getPropertyValue('--k'));
    const v = ff.getView();
    return { x: b.left + (o.x * v.zoom + v.x) * k, y: b.top + (o.y * v.zoom + v.y) * k };
  });
  const t = await el(page, '.tray button[data-shape="wedge"]').boundingBox();
  const a = { x: t!.x + t!.width / 2, y: t!.y + t!.height / 2 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((to.x + 3 - a.x) * i) / 12, a.y + ((to.y - 2 - a.y) * i) / 12);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.turn)).not.toBeNull();
  await page.waitForTimeout(260);
  await frames(page);
}

test('the ring on the tray shape to drag: 1a, 2, 3 and the word; none on 1b, 4, 5 or with the guide off; the outline behind the wedge on 1b; screenshots', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (n: string) => {
    await frames(page);
    await pausePulse(page);
    await page.screenshot({ path: `${SHOTS}/v164-${info.project.name}-${n}.png` });
    await resumePulse(page);
  };
  await open(page, '/?n=hint');
  expect(await hints(page), '1a: the wedge').toEqual(['wedge']);
  expect(await look(page, 'wedge')).toMatchObject({ anim: 'ff-tray-pulse', pe: 'none', stroke: '#378ADD', hidden: true, label: 'Add wedge', hit: true });
  await shot('1a');

  // 1b: the wedge is out, to be turned: no ring; its outline sits BEHIND it (the first thing in the wedge's own group).
  await wedgeToLanding(page);
  expect(await hints(page), '1b: none').toEqual([]);
  const under = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const id = ff.guide.turn!;
    const g = sr.querySelector(`[data-pieces] [data-piece-id="${id}"]`)!;
    const o = g.querySelector(':scope > [data-under] > [data-outline]');
    const pieces = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')];
    return {
      inPiece: !!o, first: g.firstElementChild === o?.parentElement, overlayCount: sr.querySelectorAll('[data-outlines] [data-outline]').length,
      before: !!o && !!(o.compareDocumentPosition(g.querySelector('.bd')!) & Node.DOCUMENT_POSITION_FOLLOWING), shape: o?.getAttribute('data-shape'),
      pe: o ? getComputedStyle(o).pointerEvents : null,
      // Its board placement is unchanged: the outline's own transform plus the wrapper's undoing the piece's translation.
      ctm: (() => {
        if (!o) return null;
        const t = (o as SVGGraphicsElement).getCTM()!, c = (sr.querySelector('[data-outlines]') as SVGGraphicsElement).getCTM()!;
        const m = c.inverse().multiply(t);
        return [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 10) / 10);
      })(),
      // (= its own transform: the wedge's true outline on the board, as in the outlines layer)
      want: (() => {
        if (!o) return null;
        const m = (o.parentElement as unknown as SVGGraphicsElement).getCTM()!.inverse().multiply((o as SVGGraphicsElement).getCTM()!);
        return [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 10) / 10);
      })(),
      tf: o?.getAttribute('transform') ?? '',
      true: (() => { const q = ff.guide.outlines.find((x) => x.shapeId === 'wedge')!; return [q.x, q.y, q.rotation]; })(),
      topPiece: pieces[pieces.length - 1] === g,
      // On screen the outline is where the true outline is (the drawn shape's centre near the outline's (x, y)).
      at: (() => {
        if (!o) return null;
        const r = o.getBoundingClientRect();
        return { w: r.width, h: r.height };
      })(),
      ring: !!sr.querySelector('[data-handle] [data-pulse]'),
    };
  });
  expect(under, '1b: the wedge\'s outline is drawn beneath the wedge').toMatchObject({ inPiece: true, first: true, before: true, overlayCount: 0, shape: 'wedge', pe: 'none', ring: true });
  expect(under.at!.w).toBeGreaterThan(0);
  expect(under.ctm, 'the outline stays at the true outline\'s place on the board').toEqual(under.want);
  expect(under.tf.match(/^translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/)?.slice(1).map(Number), 'at its TRUE angle').toEqual(under.true);
  await shot('1b');

  // Step 2: the black oval; the wedge's outline is gone from inside the wedge.
  await next(page).dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '2');
  expect(await hints(page), 'step 2: the black oval').toEqual(['positive-round']);
  expect(await el(page, '[data-pieces] [data-outline]').count(), 'no outline inside a piece outside the lesson').toBe(0);
  await shot('2');
  await next(page).dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '3');
  expect(await hints(page), 'step 3: the white oval').toEqual(['negative-round']);
  await next(page).dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  expect(await hints(page), 'step 4: none').toEqual([]);
  await next(page).dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(await hints(page), 'step 5: none').toEqual([]);

  // The word: every shape an unfilled outline of the current batch needs.
  await el(page, '.guide [data-guide=word]').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await next(page).dispatchEvent('click');
  await next(page).dispatchEvent('click');
  await page.waitForFunction(() => {
    const f = document.querySelector('fridge-face') as unknown as { viewGlide: number; wordFitPending: unknown };
    return !f.viewGlide && !f.wordFitPending;
  });
  const want = await page.evaluate(() => {
    const ff = document.querySelector('fridge-face')!;
    return [...new Set([...ff.shadowRoot!.querySelectorAll<SVGGElement>('[data-outline]')].map((g) => g.dataset.shape!))].sort();
  });
  expect(want.length).toBeGreaterThan(0);
  expect(await hints(page), 'the word: the shapes the current batch still needs').toEqual(want);
  await shot('6-word');

  // Exit: none.
  await el(page, '.gbar [data-gbar=exit]').dispatchEvent('click');
  await expect(guide(page)).toBeHidden();
  expect(await hints(page), 'guide off: none').toEqual([]);
  expect(errors).toEqual([]);
});

test('the tray ring keeps the tray\'s layout: same button boxes with and without it', async ({ page }) => {
  await open(page, '/?n=hintbox');
  const boxes = () => page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('.tray, .tray button')].map((e) => {
    const r = e.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',');
  }));
  const on = await boxes();
  expect(await hints(page)).toEqual(['wedge']);
  await el(page, '.gbar [data-gbar=exit]').dispatchEvent('click');
  await expect(guide(page)).toBeHidden();
  expect(await hints(page)).toEqual([]);
  expect(await boxes()).toEqual(on);
});

test('reduced motion: the tray ring is steady (not animated), at half spread', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/?n=hintrm');
  expect(await hints(page)).toEqual(['wedge']);
  const l = await look(page, 'wedge');
  expect(l).toMatchObject({ anim: 'none', opacity: '1' });
  expect(l.transform, 'spread out from the shape, so it shows').not.toBe('none');
  expect(l.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
});
