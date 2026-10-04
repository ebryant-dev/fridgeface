import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * Suggestions panel (letters and words) and the first-visit intro, in Chromium AND WebKit, on the dev server.
 * A word composition is added to the live store at runtime (the same module instance the component uses), so these
 * tests never write files into src/suggestions/.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function ready(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
}

const pieceCount = (page: Page) => page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('[data-pieces] > [data-piece-id]').length);

/** Put a word composition ("hi" from the h and i letter suggestions, set tight) into the live store. Returns its piece count. */
async function addWord(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const load = (u: string) => import(/* @vite-ignore */ u);
    const { suggestionStore } = await load('/src/suggestion-store.ts');
    const sg = await load('/src/suggestions.ts');
    const { SHAPES } = await load('/src/shapes.ts');
    const shapeOf = (id: string) => SHAPES.find((s: { id: string }) => s.id === id);
    const get = (c: string) => suggestionStore.list.find((s: { char?: string; variant: number }) => s.char === c && s.variant === 1);
    const { pieces } = sg.layoutWord([get('h').pieces, get('i').pieces], shapeOf, 10);
    const r = sg.validateSuggestion(sg.toWordFile('hi', 1, sg.normaliseForSave(pieces, shapeOf)), 'word-hi-1.json');
    if (!r.ok) throw new Error(r.error);
    suggestionStore.set(r.value);
    return r.value.pieces.length as number;
  });
}

async function openPanel(page: Page, isMobile: boolean) {
  if (isMobile) {
    // On phones the Letters button lives in the menu.
    await page.locator('fridge-face [data-view=menu]').tap();
    await page.locator('fridge-face [data-menu=letters]').tap();
  } else await page.locator('fridge-face [data-view=suggest]').click();
  await expect(page.locator('fridge-face .sugg')).toBeVisible();
}

test('suggestions panel: Letters always, Words only when a word composition exists; placing a word is one undo step', async ({ page, isMobile }, info) => {
  const errors = collectErrors(page);
  await page.goto('/?n=1');
  await ready(page);
  await page.keyboard.press('Shift'); // finish the intro, if it is playing

  await openPanel(page, isMobile);
  await expect(page.locator('fridge-face .sugg [data-sec=letters]')).toBeVisible();
  const hasWords = await page.evaluate(async () => {
    const { suggestionStore } = await import(/* @vite-ignore */ '/src/suggestion-store.ts' as string);
    return (suggestionStore.list as { text?: string }[]).some((s) => typeof s.text === 'string');
  });
  // The Words section exists only while at least one word composition does.
  await expect(page.locator('fridge-face .sugg [data-sec=words]')).toBeVisible({ visible: hasWords });
  await page.locator('fridge-face [data-sugg=close]').evaluate((b: HTMLElement) => b.click()); // close (the sheet covers the dock on phones)
  await expect(page.locator('fridge-face .sugg')).toBeHidden();

  const n = await addWord(page);
  await openPanel(page, isMobile);
  const words = page.locator('fridge-face .sugg [data-sec=words]');
  await expect(words).toBeVisible();
  await expect(words.locator('h3')).toHaveText('Words');
  const btn = words.locator('button[data-file="word-hi-1.json"]');
  await expect(btn).toHaveAttribute('aria-label', 'Place the word hi, variant 1, on the board');
  await expect(btn.locator('.vn')).toHaveText('hi · 1');
  // The thumbnail renders the whole composition: a decoded image wider than tall, inside the button.
  await expect.poll(() => btn.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  const img = await btn.locator('img').boundingBox();
  const box = await btn.boundingBox();
  expect(img!.width).toBeGreaterThan(img!.height);
  expect(img!.x >= box!.x && img!.x + img!.width <= box!.x + box!.width + 0.5).toBe(true);

  await btn.evaluate((b: HTMLElement) => b.scrollIntoView({ block: 'end' }));
  await page.screenshot({ path: `.playwright-mcp/panel-${info.project.name}${process.env.SHOT_SUFFIX ?? ''}.png` });

  const before = await pieceCount(page);
  if (isMobile) await btn.tap();
  else await btn.click();
  await expect.poll(() => pieceCount(page)).toBe(before + n);
  await expect(page.locator('fridge-face #ff-live')).toContainText('Word composition hi, variant 1, placed.');
  // Centred in the view.
  const centred = await page.evaluate((count) => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const gs = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')].slice(-count).map((g) => g.querySelector('.bd')!.getBoundingClientRect());
    const l = Math.min(...gs.map((r) => r.left)), r = Math.max(...gs.map((r) => r.right)), t = Math.min(...gs.map((r) => r.top)), b = Math.max(...gs.map((r) => r.bottom));
    const board = sr.querySelector('.board')!.getBoundingClientRect();
    return { dx: Math.abs((l + r) / 2 - (board.left + board.width / 2)), dy: Math.abs((t + b) / 2 - (board.top + board.height / 2)) };
  }, n);
  expect(centred.dx).toBeLessThan(3);
  expect(centred.dy).toBeLessThan(3);
  if (isMobile) await expect(page.locator('fridge-face .sugg')).toBeHidden(); // the sheet closes on phones
  // One undo removes the whole word.
  await page.locator('fridge-face [data-history=undo]').evaluate((b: HTMLElement) => b.click());
  await expect.poll(() => pieceCount(page)).toBe(before);
  expect(errors).toEqual([]);
});

test('axe: no violations with the suggestions panel open (letters and words)', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await page.goto('/?n=2');
  await ready(page);
  await page.keyboard.press('Shift');
  await addWord(page);
  await openPanel(page, isMobile);
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const violations = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(violations).toEqual([]);
});

/** The intro: what the store holds decides which path runs (word-play-1 as-is, or the p, l, a, y letters). */
async function introExpectation(page: Page) {
  return page.evaluate(async () => {
    const { suggestionStore } = await import(/* @vite-ignore */ '/src/suggestion-store.ts' as string);
    const list = suggestionStore.list as { char?: string; text?: string; variant: number; pieces: unknown[] }[];
    const word = list.find((s) => s.text === 'play' && s.variant === 1);
    if (word) return { path: 'word', count: word.pieces.length, pieces: word.pieces as { x: number; y: number; rotation: number }[] };
    const letters = ['p', 'l', 'a', 'y'].map((c) => list.find((s) => s.char === c && s.variant === 1));
    return letters.every(Boolean) ? { path: 'letters', count: letters.reduce((n, s) => n + s!.pieces.length, 0) } : { path: 'none', count: 0 };
  });
}

const introAnims = (page: Page) =>
  page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const anims = [...sr.querySelectorAll('[data-pieces] > [data-piece-id]')].flatMap((g) => g.getAnimations());
    return {
      running: anims.filter((a) => a.playState === 'running').length,
      total: Math.max(0, ...anims.map((a) => { const t = a.effect!.getTiming(); return Number(t.delay ?? 0) + Number(t.duration ?? 0); })),
    };
  });

test('intro: first visit only, centred, at most 1.6 s, interruptible, off with reduced motion and no-intro', async ({ page, browser }, info) => {
  const errors = collectErrors(page);
  await page.goto('/?n=3');
  await ready(page);
  const want = await introExpectation(page);
  info.annotations.push({ type: 'intro path', description: want.path });
  console.log(`[${info.project.name}] intro path: ${want.path} (${want.count} pieces)`);
  expect(want.path).not.toBe('none');
  const a = await introAnims(page);
  expect(a.running, 'the intro slides in').toBeGreaterThan(0);
  expect(a.total, 'the whole intro, ms').toBeLessThanOrEqual(1600);
  expect(await pieceCount(page)).toBe(want.count);
  if (want.path === 'word') {
    // The word composition as-is: the same pieces at the same relative positions and rotations (only moved as a whole).
    const got = (await page.evaluate(() => (document.querySelector('fridge-face') as unknown as { getComposition(): { pieces: { x: number; y: number; r: number }[] } }).getComposition().pieces));
    const exp = want.pieces!;
    for (let i = 0; i < exp.length; i++) {
      expect(got[i].x - got[0].x).toBeCloseTo(exp[i].x - exp[0].x, 1);
      expect(got[i].y - got[0].y).toBeCloseTo(exp[i].y - exp[0].y, 1);
      expect(got[i].r).toBeCloseTo(exp[i].rotation, 2);
    }
  }
  await expect.poll(async () => (await introAnims(page)).running, { timeout: 3000 }).toBe(0);
  const c = await page.evaluate(() => {
    const sr = document.querySelector('fridge-face')!.shadowRoot!;
    const gs = [...sr.querySelectorAll('[data-pieces] .bd')].map((g) => g.getBoundingClientRect());
    const l = Math.min(...gs.map((r) => r.left)), r = Math.max(...gs.map((r) => r.right)), t = Math.min(...gs.map((r) => r.top)), b = Math.max(...gs.map((r) => r.bottom));
    const board = sr.querySelector('.board')!.getBoundingClientRect();
    return { dx: Math.abs((l + r) / 2 - (board.left + board.width / 2)), dy: Math.abs((t + b) / 2 - (board.top + board.height / 2)) };
  });
  expect(c.dx, 'centred horizontally').toBeLessThan(3);
  expect(c.dy, 'centred vertically').toBeLessThan(3);

  // Not on a second visit (the auto-save exists now).
  await page.waitForTimeout(600);
  await page.reload();
  await ready(page);
  expect((await introAnims(page)).running, 'no intro on a second visit').toBe(0);
  expect(await pieceCount(page)).toBe(want.count);
  expect(errors).toEqual([]);

  // Any input finishes it at once.
  const opts = { ...info.project.use } as Record<string, unknown>;
  delete opts.baseURL;
  const ctx1 = await browser.newContext({ ...opts, baseURL: info.project.use.baseURL });
  const p1 = await ctx1.newPage();
  await p1.goto('/?n=4');
  await ready(p1);
  expect((await introAnims(p1)).running).toBeGreaterThan(0);
  await p1.keyboard.press('Shift');
  expect((await introAnims(p1)).running, 'a key finishes the intro').toBe(0);
  expect(await pieceCount(p1)).toBe(want.count);
  await ctx1.close();

  // Reduced motion: the word just appears.
  const ctx2 = await browser.newContext({ ...opts, baseURL: info.project.use.baseURL, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto('/?n=5');
  await ready(p2);
  expect(await pieceCount(p2)).toBe(want.count);
  expect((await introAnims(p2)).running, 'no motion with reduced motion').toBe(0);
  await ctx2.close();

  // no-intro: nothing at all.
  const ctx3 = await browser.newContext({ ...opts, baseURL: info.project.use.baseURL });
  const p3 = await ctx3.newPage();
  await p3.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') document.querySelector('fridge-face')?.setAttribute('no-intro', '');
    });
  });
  await p3.goto('/?n=6');
  await ready(p3);
  expect(await pieceCount(p3), 'no-intro: empty board').toBe(0);
  await ctx3.close();
});
