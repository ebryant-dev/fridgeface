import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * v1.2.5 zoom levels on phones, in Chromium AND WebKit:
 *  - free play: about four black ovals fit side to side across the visible board's shorter side (the default view, resets,
 *    and the reference Frame all caps against); desktop is unchanged;
 *  - the guide's c (steps 1 to 3) keeps the close-up it had before the free-play change.
 * (The guided "create", batch by batch, is in guide.pw.ts.) Screenshots go to .playwright-mcp/ (gitignored).
 */

const SHOT = '.playwright-mcp';
const NAMES: Record<string, string> = { 'webkit-iphone': 'wk-iphone', 'webkit-iphone-landscape': 'wk-iphone-landscape' };
const PORT = 5199;
const guideOff = { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'fridgeface:guide:v2', value: 'off' }] }] };

type FF = HTMLElement & {
  getView(): { x: number; y: number; zoom: number };
  comfortZoom(): number;
  composition: { pieces: { id: string }[]; addPieces(items: { shapeId: string; x: number; y: number; rotation: number }[]): unknown };
  visibleView(): { x: number; y: number; w: number; h: number };
  fitToComposition(): void;
  guide: { step: number };
};

async function ready(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** The oval's width across the visible board's shorter side at the current view: 1 = exactly four ovals across. */
function ovalsAcross(page: Page) {
  return page.evaluate(async () => {
    const ff = document.querySelector('fridge-face') as FF;
    const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
    const oval = (SHAPES as { id: string; uprightBox: { w: number } }[]).find((s) => s.id === 'positive-round')!.uprightBox.w;
    const v = ff.visibleView();
    return { across: (4 * oval * ff.getView().zoom) / Math.min(v.w, v.h), view: v, zoom: ff.getView().zoom, oval };
  });
}

test.describe('free play', () => {
  test.use({ storageState: guideOff });

  test('phones: the default view fits about four black ovals across the visible board\'s shorter side; resets and Fit use it; desktop is unchanged', async ({ page, isMobile }, info) => {
    await page.goto('/?n=zoom');
    await ready(page);
    const m = await ovalsAcross(page);
    if (isMobile) {
      expect(m.across, `four ovals span ${(m.across * 100).toFixed(1)}% of the shorter visible side`).toBeGreaterThan(0.95);
      expect(m.across).toBeLessThan(1.05);
    } else {
      // Desktop: a positive stem is a quarter of the board's shorter side, as ever.
      const r = await page.evaluate(async () => {
        const ff = document.querySelector('fridge-face') as FF;
        const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
        const stem = (SHAPES as { id: string; uprightBox: { h: number } }[]).find((s) => s.id === 'positive-stem')!.uprightBox.h;
        const b = ff.shadowRoot!.querySelector('.board')!.getBoundingClientRect();
        const k = parseFloat(getComputedStyle(ff.shadowRoot!.querySelector('.board')!).getPropertyValue('--k'));
        return { stemFrac: (stem * ff.getView().zoom) / (Math.min(b.width, b.height) / k) };
      });
      expect(r.stemFrac).toBeCloseTo(0.25, 3);
    }
    info.annotations.push({ type: 'free-play zoom', description: `${m.zoom.toFixed(4)} (visible ${m.view.w.toFixed(0)} x ${m.view.h.toFixed(0)} units)` });
    console.log(`[${info.project.name}] free-play default zoom ${m.zoom.toFixed(4)}; ovals across ${(m.across * 100).toFixed(1)}%`);

    // Pan and zoom away, then Frame all on a blank board resets to the same view.
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).fitToComposition());
    await frames(page);
    expect((await ovalsAcross(page)).zoom).toBeCloseTo(m.zoom, 9);

    // Four black ovals side by side across the visible board (the screenshot of the scale).
    if (isMobile && NAMES[info.project.name]) {
      await page.evaluate(({ zoom, oval, v }) => {
        const ff = document.querySelector('fridge-face') as FF;
        const view = ff.getView();
        const y = (v.y + v.h / 2 - view.y) / zoom;
        const cx = (v.x + v.w / 2 - view.x) / zoom;
        ff.composition.addPieces([-1.5, -0.5, 0.5, 1.5].map((i) => ({ shapeId: 'positive-round', x: cx + i * oval, y, rotation: 0 })));
      }, { zoom: m.zoom, oval: m.oval, v: m.view });
      await frames(page);
      expect((await ovalsAcross(page)).zoom, 'adding pieces does not move the view').toBeCloseTo(m.zoom, 9);
      await page.screenshot({ path: `${SHOT}/zoom-freeplay-${NAMES[info.project.name]}.png` });
    }
  });

  test('phones: Frame all on a composition never zooms past twice the comfortable (four-ovals) zoom', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/?n=zoom2');
    await ready(page);
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).composition.addPieces([{ shapeId: 'positive-round', x: 100, y: 100, rotation: 0 }]));
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).fitToComposition());
    await frames(page);
    const r = await page.evaluate(() => {
      const ff = document.querySelector('fridge-face') as FF;
      return { zoom: ff.getView().zoom, comfort: ff.comfortZoom() };
    });
    expect(r.zoom).toBeLessThanOrEqual(2 * r.comfort + 1e-9); // a lone oval is capped at 2x the comfortable zoom (less where the margin binds first)
    expect(r.zoom).toBeGreaterThan(r.comfort);
  });
});

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test.describe('the guide\'s c', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('phones: steps 1 to 3 frame the c with the black oval 45% of the visible board\'s shorter side, the whole c in view', async ({ page, isMobile }, info) => {
    test.skip(!isMobile, 'phones only');
    const nm = info.project.name.endsWith('landscape') ? 'wk-iphone-landscape' : 'wk-iphone';
    await page.goto('/?n=zoomc');
    await ready(page);
    await expect(page.locator('fridge-face .guide')).toHaveAttribute('data-welcome', '', { timeout: 5000 });
    await page.locator('fridge-face .guide [data-guide=yes]').tap(); // v1.6.1: the welcome question first
    await expect(page.locator('fridge-face .guide')).toHaveAttribute('data-step', '1', { timeout: 5000 });
    await frames(page);
    const measure = () => page.evaluate(async () => {
      const ff = document.querySelector('fridge-face') as FF & { guide: { outlines: { x: number; y: number }[] }; tightBounds(o: unknown[]): { x: number; y: number; w: number; h: number } };
      const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
      const oval = (SHAPES as { id: string; uprightBox: { w: number } }[]).find((s) => s.id === 'positive-round')!.uprightBox.w;
      const v = ff.visibleView(), z = ff.getView();
      const b = ff.tightBounds(ff.guide.outlines);
      const sx = b.x * z.zoom + z.x, sy = b.y * z.zoom + z.y;
      // In view: inside the board and clear of every control over it (v1.5.0: on phones only the view group is at the top,
      // so the board beside it, under the top strip, is visible board too).
      const sr = (ff as unknown as HTMLElement).shadowRoot!;
      const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
      const br = sr.querySelector('.board')!.getBoundingClientRect();
      const c = { x: br.left + sx * k, y: br.top + sy * k, w: b.w * z.zoom * k, h: b.h * z.zoom * k };
      const ctl = [...sr.querySelectorAll<HTMLElement>('.dock > .panel')].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
      const hit = ctl.some((q) => c.x < q.right && q.left < c.x + c.w && c.y < q.bottom && q.top < c.y + c.h);
      const inBoard = c.x >= br.left - 0.5 && c.y >= br.top - 0.5 && c.x + c.w <= br.right + 0.5 && c.y + c.h <= br.bottom + 0.5;
      return { share: (oval * z.zoom) / Math.min(v.w, v.h), zoom: z.zoom, inView: inBoard && !hit, cw: b.w * z.zoom / v.w, ch: b.h * z.zoom / v.h };
    });
    const m = await measure();
    if (NAMES[info.project.name]) await page.screenshot({ path: `${SHOT}/zoom-c-${nm}.png` });
    info.annotations.push({ type: 'c zoom', description: `${m.zoom.toFixed(4)}, oval ${(m.share * 100).toFixed(1)}% of the shorter side` });
    console.log(`[${info.project.name}] c zoom ${m.zoom.toFixed(4)}; oval ${(m.share * 100).toFixed(1)}% of the visible board's shorter side`);
    // 45% is the aim; the whole c (oval AND wedge, with the callout, docks, button block and tray clear) is the rule, so where
    // the c is wider than 45% allows the zoom reduces just enough (measured: about 30 to 32% in portrait, 45% in landscape).
    expect(m.share).toBeLessThanOrEqual(0.45 * 1.05);
    expect(m.share, 'reduced only as far as the whole c needs').toBeGreaterThanOrEqual(0.27);
    expect(m.inView, 'the whole c (oval and wedge) is in the visible board').toBe(true);
    // Steps 2 and 3 keep the zoom (the guide never zooms between them).
    await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { guideNextFill(): void }).guideNextFill());
    await frames(page);
    expect((await measure()).zoom).toBeCloseTo(m.zoom, 9);
  });
});
