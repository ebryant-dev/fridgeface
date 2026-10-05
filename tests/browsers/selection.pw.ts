import { expect, test, type Page } from '@playwright/test';

/**
 * Multi-select (v0.5.0), in Chromium AND WebKit. Desktop: box selection on the empty board (real geometry, Shift adds),
 * Shift+click, group drag / rotation / restack / delete, Ctrl+A, panning by wheel and Space+drag. Phones: one finger pans,
 * long-press then drag draws a box, long-press on a piece toggles it, a quick drag still drags, a two-finger twist turns the
 * selection rigidly, the action bar acts on the group, and the selection UI never overlaps the docks, action bar or tray.
 *
 * Touch: Chromium gets REAL touch input (CDP Input.dispatchTouchEvent, which the browser turns into touch pointer events).
 * WebKit has no touch-drag API in Playwright, so there the same touch pointer sequence is dispatched as PointerEvents
 * (pointerType "touch") on the element under the finger, with pointer capture stubbed (a synthetic pointer cannot be captured).
 */

type FF = HTMLElement & {
  loadComposition(d: unknown): { ok: boolean };
  getComposition(): { pieces: { s: string; x: number; y: number; r: number }[] };
  getView(): { x: number; y: number; zoom: number };
  undo(): void;
};
type P = { s: string; x: number; y: number; r: number };
type Pt = { x: number; y: number };

const SHOT = '.playwright-mcp';

async function open(page: Page) {
  await page.goto('/?n=ms');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.keyboard.press('Shift'); // finish the intro, if it is playing
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Replace the board (framed in the visible board) and settle. */
async function load(page: Page, pieces: P[]) {
  await page.evaluate((pieces) => (document.querySelector('fridge-face') as FF).loadComposition({ v: 1, pieces }), pieces);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
}

/** The composition at full precision (the wire format rounds x/y to 0.1 and r to 0.01, too coarse for the rigidity checks). */
const comp = (page: Page): Promise<P[]> =>
  page.evaluate(() =>
    (document.querySelector('fridge-face') as unknown as { composition: { pieces: { shapeId: string; x: number; y: number; rotation: number }[] } })
      .composition.pieces.map((p) => ({ s: p.shapeId, x: p.x, y: p.y, r: p.rotation })),
  );
/** The selection as indexes into the stacking order (the component's private state, read for the test). */
const selected = (page: Page) =>
  page.evaluate(() => {
    const ff = document.querySelector('fridge-face') as unknown as { selection: string[]; composition: { indexOf(id: string): number } };
    return ff.selection.map((id) => ff.composition.indexOf(id)).sort((a, b) => a - b);
  });
const camera = (page: Page) => page.evaluate(() => (document.querySelector('fridge-face') as FF).getView());
const live = (page: Page) => page.locator('fridge-face #ff-live');

/** Board point -> client point. */
function toClient(page: Page, p: Pt) {
  return page.evaluate((p) => {
    const ff = document.querySelector('fridge-face') as FF;
    const sr = ff.shadowRoot!;
    const board = sr.querySelector('.board')!.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(sr.querySelector('.board')!).getPropertyValue('--k'));
    const v = ff.getView();
    return { x: board.left + (p.x * v.zoom + v.x) * k, y: board.top + (p.y * v.zoom + v.y) * k };
  }, p);
}

/** A client point that hits piece `i` (stacking index) and nothing above it: sampled from its outline toward its centroid. */
function pointOn(page: Page, i: number) {
  return page.evaluate((i) => {
    const ff = document.querySelector('fridge-face') as unknown as FF & { composition: { pieces: { id: string; x: number; y: number }[] } };
    const sr = ff.shadowRoot!;
    const p = ff.composition.pieces[i];
    const g = sr.querySelector(`[data-pieces] > [data-piece-id="${p.id}"] .bd`)!;
    const r = g.getBoundingClientRect();
    const hits = (x: number, y: number) => (sr.elementFromPoint(x, y) as Element | null)?.closest('[data-piece-id]')?.getAttribute('data-piece-id') === p.id;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (hits(cx, cy)) return { x: cx, y: cy };
    for (let t = 0.1; t < 0.95; t += 0.05) for (let a = 0; a < 360; a += 15) {
      const x = cx + Math.cos((a * Math.PI) / 180) * t * r.width / 2, y = cy + Math.sin((a * Math.PI) / 180) * t * r.height / 2;
      if (hits(x, y)) return { x, y };
    }
    throw new Error(`no free point on piece ${i}`);
  }, i);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function expectRigid(before: P[], after: P[], idx: number[]) {
  for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
    const i = idx[a], j = idx[b];
    expect(Math.abs(dist(after[i], after[j]) - dist(before[i], before[j])), `distance ${i}-${j} preserved`).toBeLessThan(0.01);
  }
  const turn = (i: number) => ((((after[i].r - before[i].r) % 360) + 540) % 360) - 180;
  for (const i of idx) expect(Math.abs(turn(i) - turn(idx[0])), `piece ${i} turned by the same angle`).toBeLessThan(0.01);
  return turn(idx[0]);
}

async function drag(page: Page, from: Pt, to: Pt, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = 1; s <= steps; s++) await page.mouse.move(from.x + ((to.x - from.x) * s) / steps, from.y + ((to.y - from.y) * s) / steps);
  await page.mouse.up();
}

// ---- touch (real in Chromium, scripted touch pointer events in WebKit) -------------------------------------------

type Finger = { id: number; x: number; y: number };
class Touch {
  private cdp: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>> | null = null;
  private down = new Map<number, Finger>();
  constructor(private page: Page, private browserName: string) {}
  async init() {
    if (this.browserName === 'chromium') this.cdp = await this.page.context().newCDPSession(this.page);
    else await this.page.evaluate(() => { Element.prototype.setPointerCapture = function () {}; });
  }
  private async send(type: 'start' | 'move' | 'end', f: Finger) {
    if (type === 'end') this.down.delete(f.id);
    else this.down.set(f.id, f);
    if (this.cdp) {
      const t = type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd';
      await this.cdp.send('Input.dispatchTouchEvent', { type: t, touchPoints: [...this.down.values()].map((p) => ({ x: p.x, y: p.y, id: p.id })) });
      return;
    }
    await this.page.evaluate(({ type, f }) => {
      const sr = document.querySelector('fridge-face')!.shadowRoot!;
      const surface = sr.querySelector('svg.surface')!;
      const target = type === 'start' ? (sr.elementFromPoint(f.x, f.y) ?? surface) : surface;
      const name = type === 'start' ? 'pointerdown' : type === 'move' ? 'pointermove' : 'pointerup';
      target.dispatchEvent(new PointerEvent(name, { pointerId: 100 + f.id, pointerType: 'touch', isPrimary: f.id === 1, clientX: f.x, clientY: f.y, bubbles: true, composed: true, button: type === 'move' ? -1 : 0, buttons: type === 'end' ? 0 : 1 }));
    }, { type, f });
  }
  start(id: number, p: Pt) { return this.send('start', { id, ...p }); }
  move(id: number, p: Pt) { return this.send('move', { id, ...p }); }
  end(id: number) { return this.send('end', this.down.get(id)!); }
  async path(id: number, from: Pt, to: Pt, steps = 10) {
    for (let s = 1; s <= steps; s++) await this.move(id, { x: from.x + ((to.x - from.x) * s) / steps, y: from.y + ((to.y - from.y) * s) / steps });
  }
}

/** Four pieces: a round (0), a stem far to its right (1), a round placed so a box can cross its bounding-box corner without touching it (2), a wedge (3). */
const SCENE: P[] = [
  { s: 'positive-round', x: 0, y: 0, r: 0 },
  { s: 'positive-stem', x: 700, y: 0, r: 0 },
  { s: 'negative-round', x: 330, y: 390, r: 0 },
  { s: 'wedge', x: -420, y: 380, r: 25 },
];

/** Board bounding box of piece i's real outline (via the shape hulls) and of its rotated bbox corners. */
function outlineBounds(page: Page, i: number) {
  return page.evaluate(async (i) => {
    const load = (u: string) => import(/* @vite-ignore */ u);
    const { SHAPES } = await load('/src/shapes.ts');
    const ff = document.querySelector('fridge-face') as FF;
    const p = ff.getComposition().pieces[i];
    const s = SHAPES.find((x: { id: string }) => x.id === p.s);
    const th = (p.r * Math.PI) / 180;
    const pts = s.hull.map((q: Pt) => ({ x: p.x + q.x * Math.cos(th) - q.y * Math.sin(th), y: p.y + q.x * Math.sin(th) + q.y * Math.cos(th) }));
    const xs = pts.map((q: Pt) => q.x), ys = pts.map((q: Pt) => q.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), pts };
  }, i);
}

// =====================================================================================================================
// Desktop
// =====================================================================================================================

test.describe('desktop', () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, 'desktop profiles only'));

  test('a box drag on the empty board selects exactly the pieces whose real shape it touches; Shift+box adds; a plain click deselects', async ({ page }, info) => {
    await open(page);
    await load(page, SCENE);
    const a = await outlineBounds(page, 0);
    const c = await outlineBounds(page, 2);
    // The box covers the round 0 entirely and reaches 14 units into round 2's bounding-box corner, where the oval is not.
    const from = { x: a.minX - 60, y: a.minY - 60 };
    const to = { x: c.minX + 14, y: c.minY + 14 };
    const inside = c.pts.some((p: Pt) => p.x <= to.x && p.y <= to.y);
    expect(inside, 'precondition: the box misses round 2 itself').toBe(false);
    expect(to.x > c.minX && to.y > c.minY, 'precondition: the box overlaps round 2\'s bounding box').toBe(true);

    const f = await toClient(page, from), t = await toClient(page, to);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    const mid = { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 };
    for (let s = 1; s <= 6; s++) await page.mouse.move(f.x + ((mid.x - f.x) * s) / 6, f.y + ((mid.y - f.y) * s) / 6);
    await expect(page.locator('fridge-face [data-marquee]')).toHaveCount(1);
    if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/ms-desktop-box.png` });
    for (let s = 1; s <= 6; s++) await page.mouse.move(mid.x + ((t.x - mid.x) * s) / 6, mid.y + ((t.y - mid.y) * s) / 6);
    await page.mouse.up();
    expect(await selected(page)).toEqual([0]);
    await expect(page.locator('fridge-face [data-marquee]')).toHaveCount(0);
    await expect(live(page)).toContainText('1 piece selected.');
    const cam0 = await camera(page);

    // Shift + box around the stem adds it.
    const s1 = await outlineBounds(page, 1);
    await page.keyboard.down('Shift');
    await drag(page, await toClient(page, { x: s1.minX - 30, y: s1.minY + 20 }), await toClient(page, { x: s1.maxX + 30, y: s1.minY + 80 }));
    await page.keyboard.up('Shift');
    expect(await selected(page)).toEqual([0, 1]);
    await expect(live(page)).toContainText('2 pieces selected.');
    expect(await camera(page), 'a drag on the empty board no longer pans').toEqual(cam0);

    // A plain click on the empty board deselects.
    const empty = await toClient(page, { x: 330, y: -150 });
    await page.mouse.click(empty.x, empty.y);
    expect(await selected(page)).toEqual([]);
    await expect(page.locator('fridge-face .actions')).toBeHidden();
  });

  test('Shift+click adds and removes; a plain click on one piece of a selection collapses it; Ctrl+A selects all; Escape deselects', async ({ page }) => {
    await open(page);
    await load(page, SCENE);
    const p0 = await pointOn(page, 0), p2 = await pointOn(page, 2), p3 = await pointOn(page, 3);
    await page.mouse.click(p0.x, p0.y);
    expect(await selected(page)).toEqual([0]);
    await page.keyboard.down('Shift');
    await page.mouse.click(p2.x, p2.y);
    await page.mouse.click(p3.x, p3.y);
    expect(await selected(page)).toEqual([0, 2, 3]);
    await page.mouse.click(p0.x, p0.y);
    await page.keyboard.up('Shift');
    expect(await selected(page)).toEqual([2, 3]);
    await expect(page.locator('fridge-face [data-sel-outline]')).toHaveCount(2);
    await expect(page.locator('fridge-face [data-selection-box] [data-handle]')).toHaveCount(1);
    await page.mouse.click(p2.x, p2.y); // plain click, no drag: collapse to that piece
    expect(await selected(page)).toEqual([2]);

    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    expect(await selected(page)).toEqual([0, 1, 2, 3]);
    await expect(live(page)).toContainText('4 pieces selected.');
    await page.keyboard.press('n'); // N / P select ONE piece
    expect((await selected(page)).length).toBe(1);
    await page.keyboard.press('Control+a');
    // With the onboarding guide showing (FF_GUIDE=on), Escape skips the guide before it deselects (by design): skip it first.
    const skip = page.locator('fridge-face .guide [data-guide=skip]');
    if (await skip.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(skip).toBeHidden();
    }
    await page.keyboard.press('Escape');
    expect(await selected(page)).toEqual([]);
    await expect(live(page)).toContainText('Selection cleared.');
  });

  test('dragging one selected piece moves them all with their offsets unchanged (one undo step); arrows nudge the group', async ({ page }) => {
    await open(page);
    await load(page, SCENE);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    const before = await comp(page);
    const p = await pointOn(page, 1);
    await drag(page, p, { x: p.x + 90, y: p.y + 40 });
    const after = await comp(page);
    const dx = after[0].x - before[0].x, dy = after[0].y - before[0].y;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(50);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(dx, 6);
      expect(after[i].y - before[i].y).toBeCloseTo(dy, 6);
      expect(after[i].r).toBe(before[i].r);
    }
    expect(await selected(page), 'the selection stays').toEqual([0, 1, 2, 3]);
    await expect(live(page)).toContainText('4 pieces moved.');
    // Arrow keys: 1 unit (Shift: 10) for every piece, coalesced into one undo step.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const nudged = await comp(page);
    for (let i = 0; i < before.length; i++) {
      expect(nudged[i].x - after[i].x).toBeCloseTo(2, 6);
      expect(nudged[i].y - after[i].y).toBeCloseTo(10, 6);
    }
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).undo());
    expect(await comp(page)).toEqual(after);
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).undo());
    expect(await comp(page), 'the whole drag was one undo step').toEqual(before);
  });

  test('the handle rotates a 3-piece selection as one rigid unit; , and . turn it 1 degree (one coalesced undo step)', async ({ page }, info) => {
    await open(page);
    await load(page, SCENE.slice(0, 3));
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/ms-desktop-selected.png` });
    const before = await comp(page);
    const handle = await page.locator('fridge-face [data-selection-box] [data-handle] circle').first().boundingBox();
    const box = await page.locator('fridge-face [data-selection-box] rect').first().boundingBox();
    expect(handle!.width, 'the handle target is at least 44px').toBeGreaterThanOrEqual(43.5);
    const h = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
    const c = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    // Swing the handle 40 degrees clockwise about the box centre.
    const R = dist(h, c), a0 = Math.atan2(h.y - c.y, h.x - c.x);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) {
      const a = a0 + ((40 * Math.PI) / 180) * (s / 10);
      await page.mouse.move(c.x + R * Math.cos(a), c.y + R * Math.sin(a));
    }
    await page.mouse.up();
    const after = await comp(page);
    const turn = expectRigid(before, after, [0, 1, 2]);
    expect(turn).toBeGreaterThan(35);
    expect(turn).toBeLessThan(45);
    await expect(live(page)).toContainText(/3 pieces rotated to \d+(\.\d)? degrees\./);
    // The box turned with the selection.
    expect(await page.locator('fridge-face [data-group]').getAttribute('transform')).toMatch(/rotate\((3\d|4\d)/);
    if (info.project.name === 'chromium-desktop') await page.screenshot({ path: `${SHOT}/ms-desktop-rotated.png` });
    // Keys: 1 degree per press, rigid, coalesced.
    for (let i = 0; i < 5; i++) await page.keyboard.press('.');
    const keyed = await comp(page);
    expect(expectRigid(after, keyed, [0, 1, 2])).toBeCloseTo(5, 6);
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).undo());
    const undone = await comp(page);
    undone.forEach((p, i) => {
      expect(p.x).toBeCloseTo(after[i].x, 6);
      expect(p.r).toBeCloseTo(after[i].r, 6);
    });
    await page.evaluate(() => (document.querySelector('fridge-face') as FF).undo());
    expect(await comp(page), 'the handle drag was one undo step').toEqual(before);
  });

  test('forward / back with an interleaved stack passes the next OVERLAPPING piece and keeps both orders; no-op is disabled and says so', async ({ page }) => {
    await open(page);
    // Stacking order, bottom first: S0 (selected), U1 (far away), S2 (selected), U3 (overlaps S2), U4 (overlaps S0).
    await load(page, [
      { s: 'positive-stem', x: 0, y: 0, r: 0 },
      { s: 'positive-round', x: 1500, y: 0, r: 0 },
      { s: 'positive-round', x: 600, y: 0, r: 0 },
      { s: 'negative-round', x: 640, y: 30, r: 0 },
      { s: 'wedge', x: 10, y: 160, r: 0 },
    ]);
    const tag = (ps: P[]) => ps.map((p) => `${p.s}@${p.x}`);
    const S0 = 'positive-stem@0', U1 = 'positive-round@1500', S2 = 'positive-round@600', U3 = 'negative-round@640', U4 = 'wedge@10';
    const p0 = await pointOn(page, 0), p2 = await pointOn(page, 2);
    await page.mouse.click(p0.x, p0.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.up('Shift');
    expect(await selected(page)).toEqual([0, 2]);
    const fwd = page.locator('fridge-face [data-action=forward]'), back = page.locator('fridge-face [data-action=backward]');
    await expect(back, 'nothing below overlaps the selection').toBeDisabled();
    await fwd.click();
    expect(tag(await comp(page))).toEqual([U1, U3, S0, S2, U4]);
    await expect(live(page)).toContainText('2 pieces moved forward.');
    await fwd.click();
    expect(tag(await comp(page))).toEqual([U1, U3, U4, S0, S2]);
    await expect(fwd, 'nothing above overlaps any more').toBeDisabled();
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press(']');
    await expect(live(page)).toContainText('Nothing above overlaps them.');
    expect(tag(await comp(page))).toEqual([U1, U3, U4, S0, S2]);
    await page.keyboard.press('[');
    expect(tag(await comp(page))).toEqual([U1, U3, S0, S2, U4]);
    // A single piece: S2 alone, back past U3 (the round it overlaps), not past U1 (far away).
    await page.keyboard.press('Escape');
    const q = await pointOn(page, 3); // S2 is index 3 now
    await page.mouse.click(q.x, q.y);
    expect(await selected(page)).toEqual([3]);
    await page.keyboard.press('[');
    expect(tag(await comp(page))).toEqual([U1, S2, U3, S0, U4]);
    await expect(live(page)).toContainText('Moved backward. 2 of 5 in stacking order.');
    await page.keyboard.press('[');
    await expect(live(page)).toContainText('Nothing below overlaps it.');
    expect(tag(await comp(page))).toEqual([U1, S2, U3, S0, U4]);
  });

  test('Delete removes every selected piece; one undo brings them all back', async ({ page }) => {
    await open(page);
    await load(page, SCENE);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    await expect(page.locator('fridge-face [data-action=delete]')).toHaveAttribute('aria-label', 'Delete 4 pieces');
    await page.keyboard.press('Delete');
    expect(await comp(page)).toEqual([]);
    await expect(live(page)).toContainText('4 pieces deleted.');
    await page.keyboard.press('Control+z');
    expect((await comp(page)).length).toBe(4);
    // The action bar's Delete does the same.
    await page.keyboard.press('Control+a');
    await page.locator('fridge-face [data-action=delete]').click();
    expect(await comp(page)).toEqual([]);
    await page.locator('fridge-face [data-history=undo]').click();
    expect((await comp(page)).length).toBe(4);
  });

  test('panning still works: wheel and Space + drag (a plain drag selects instead)', async ({ page }) => {
    await open(page);
    await load(page, SCENE);
    const board = (await page.locator('fridge-face .board').boundingBox())!;
    const c = { x: board.x + board.width * 0.5, y: board.y + 40 };
    const v0 = await camera(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await camera(page)).y, { message: 'wheel pans' }).not.toBe(v0.y);
    const v1 = await camera(page);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.down('Space');
    await drag(page, c, { x: c.x + 80, y: c.y + 30 });
    await page.keyboard.up('Space');
    await expect.poll(async () => (await camera(page)).x, { message: 'Space + drag pans' }).not.toBe(v1.x);
    expect(await selected(page), 'Space + drag selected nothing').toEqual([]);
  });

  test('axe: no violations with a multi-selection active (desktop)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
    await open(page);
    await load(page, SCENE);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
      return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
    });
    expect(violations).toEqual([]);
  });
});

// =====================================================================================================================
// Phones
// =====================================================================================================================

/** Three pieces close together, so they frame large in the visible board. */
const PHONE: P[] = [
  { s: 'positive-round', x: 0, y: 0, r: 0 },
  { s: 'negative-stem', x: 300, y: -20, r: 10 },
  { s: 'wedge', x: 150, y: 330, r: -20 },
];

test.describe('phone', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'phone profiles only'));

  test('one finger on the empty board still pans; a tap there deselects', async ({ page, browserName }) => {
    await open(page);
    await load(page, PHONE);
    const t = new Touch(page, browserName);
    await t.init();
    const start = await toClient(page, { x: -260, y: -60 });
    const v0 = await camera(page);
    await t.start(1, start);
    await t.path(1, start, { x: start.x + 50, y: start.y + 40 }, 8);
    await t.end(1);
    await expect.poll(async () => (await camera(page)).x).not.toBe(v0.x);
    const v1 = await camera(page);
    const k = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('fridge-face')!.shadowRoot!.querySelector('.board')!).getPropertyValue('--k')));
    expect((v1.x - v0.x) * k).toBeCloseTo(50, 0);
    expect(await selected(page)).toEqual([]);
  });

  test('long-press on the empty board arms a box (a ring shows); dragging then selects what the box touches; lifting without a drag changes nothing', async ({ page, browserName }, info) => {
    await open(page);
    await load(page, PHONE);
    const t = new Touch(page, browserName);
    await t.init();
    const a = await outlineBounds(page, 0), b = await outlineBounds(page, 1);
    const start = await toClient(page, { x: a.minX - 30, y: Math.min(a.minY, b.minY) - 30 });
    const end = await toClient(page, { x: b.minX + 30, y: a.maxY - 40 });
    const v0 = await camera(page);
    await t.start(1, start);
    await page.waitForTimeout(550);
    await expect(page.locator('fridge-face .lp'), 'the long-press ring shows').toHaveCount(1);
    if (info.project.name === 'webkit-iphone') await page.screenshot({ path: `${SHOT}/ms-wk-iphone-longpress.png` });
    await t.path(1, start, end, 10);
    await expect(page.locator('fridge-face [data-marquee]')).toHaveCount(1);
    await t.end(1);
    expect(await selected(page)).toEqual([0, 1]);
    await expect(page.locator('fridge-face .lp')).toHaveCount(0);
    expect(await camera(page), 'the box did not pan').toEqual(v0);
    await expect(live(page)).toContainText('2 pieces selected.');

    // Armed, then lifted without a drag: cancelled quietly, the selection stays.
    await t.start(1, start);
    await page.waitForTimeout(550);
    await expect(page.locator('fridge-face .lp')).toHaveCount(1);
    await t.end(1);
    await expect(page.locator('fridge-face .lp')).toHaveCount(0);
    expect(await selected(page)).toEqual([0, 1]);
  });

  test('long-press on a piece adds or removes it; a tap collapses; a quick drag still drags it', async ({ page, browserName }) => {
    await open(page);
    await load(page, PHONE);
    const t = new Touch(page, browserName);
    await t.init();
    const hold = async (i: number) => {
      const p = await pointOn(page, i);
      await t.start(1, p);
      await page.waitForTimeout(550);
      await t.end(1);
    };
    await hold(0);
    expect(await selected(page)).toEqual([0]);
    await hold(2);
    expect(await selected(page)).toEqual([0, 2]);
    await expect(live(page)).toContainText('2 pieces selected.');
    await hold(0);
    expect(await selected(page)).toEqual([2]);
    await hold(1);
    expect(await selected(page)).toEqual([1, 2]);
    // A tap on a piece of the selection collapses it to that piece, on release.
    const p1 = await pointOn(page, 1);
    await t.start(1, p1);
    await t.end(1);
    expect(await selected(page)).toEqual([1]);
    // A quick drag on another piece drags it (and selects it alone), as before.
    const before = await comp(page);
    const p0 = await pointOn(page, 0);
    await t.start(1, p0);
    await t.path(1, p0, { x: p0.x + 60, y: p0.y + 30 }, 8);
    await t.end(1);
    const after = await comp(page);
    expect(after[0].x).toBeGreaterThan(before[0].x + 100);
    expect(after[1]).toEqual(before[1]);
    expect(await selected(page)).toEqual([0]);
  });

  test('a two-finger twist with the first finger on the selection turns it as one rigid unit; the action bar acts on the group', async ({ page, browserName }, info) => {
    await open(page);
    await load(page, PHONE);
    const t = new Touch(page, browserName);
    await t.init();
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    expect(await selected(page)).toEqual([0, 1, 2]);
    const before = await comp(page);
    const f1 = await pointOn(page, 0);
    const f2s = { x: f1.x + 120, y: f1.y };
    await t.start(1, f1);
    await t.start(2, f2s);
    for (let s = 1; s <= 10; s++) {
      const a = ((30 * Math.PI) / 180) * (s / 10);
      await t.move(2, { x: f1.x + 120 * Math.cos(a), y: f1.y + 120 * Math.sin(a) });
    }
    await t.end(2);
    await t.end(1);
    const after = await comp(page);
    const turn = expectRigid(before, after, [0, 1, 2]);
    expect(turn).toBeGreaterThan(25);
    expect(turn).toBeLessThan(35);
    expect(await selected(page)).toEqual([0, 1, 2]);
    await expect(live(page)).toContainText('3 pieces rotated to ');

    // The action bar acts on the whole group: Delete removes all three; Undo restores them.
    await page.locator('fridge-face [data-action=delete]').tap();
    expect(await comp(page)).toEqual([]);
    await page.locator('fridge-face [data-history=undo]').tap();
    expect((await comp(page)).length).toBe(3);
    if (info.project.name === 'webkit-iphone') { /* screenshot taken in the overlap test */ }
  });

  test('the selection UI never overlaps the docks, the action bar or the tray', async ({ page }, info) => {
    await open(page);
    await load(page, PHONE);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    const s = await page.evaluate(() => {
      const sr = document.querySelector('fridge-face')!.shadowRoot!;
      const rect = (e: Element) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number; name?: string };
      const ui = rect(sr.querySelector('[data-selection-box]')!);
      const others: { name: string; r: ReturnType<typeof rect> }[] = [];
      for (const [name, sel] of [['tray', '.tray'], ['history', '.dock > .history'], ['view', '.dock > .view'], ['actions', '.actions']]) {
        const e = sr.querySelector<HTMLElement>(sel)!;
        if (!e.hidden && getComputedStyle(e).display !== 'none') others.push({ name, r: rect(e) });
      }
      return { ui, others, outlines: sr.querySelectorAll('[data-sel-outline]').length, handles: sr.querySelectorAll('[data-handle]').length };
    });
    expect(s.outlines).toBe(3);
    expect(s.handles, 'ONE rotate handle').toBe(1);
    expect(s.others.map((o) => o.name)).toContain('actions');
    const ov = (a: typeof s.ui, b: typeof s.ui) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
    for (const o of s.others) expect.soft(ov(s.ui, o.r), `selection UI ${JSON.stringify(s.ui)} overlaps ${o.name} ${JSON.stringify(o.r)}`).toBe(false);
    if (info.project.name === 'webkit-iphone') await page.screenshot({ path: `${SHOT}/ms-wk-iphone-selected.png` });
  });

  test('axe: no violations with a multi-selection active (phone)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
    await open(page);
    await load(page, PHONE);
    await page.locator('fridge-face .board svg.surface').focus();
    await page.keyboard.press('Control+a');
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
      return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
    });
    expect(violations).toEqual([]);
  });
});
