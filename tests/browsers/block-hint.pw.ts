import { expect, test, type Page } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * v1.6.5: the button block's Forward (Bring forward) or Back (Send backward) the guide's callout points at wears the same
 * blueprint-blue pulse as the handle and tray hints (c step 4; the word's stacking prompts); none elsewhere, none when the
 * callout falls back to the piece or the guide is off; static under reduced motion; decorative (aria-hidden, no pointer
 * events, no layout change). Chromium AND WebKit, desktop, phone portrait and phone landscape. Screenshots go to FF_SHOTS
 * (default .playwright-mcp) as v165-<project>-<step>.png, the pulse paused mid-spread.
 */

test.use({ storageState: { cookies: [], origins: [] } });

type FF = HTMLElement & {
  guide: { step: number; stack: { id: string; dir: 'back' | 'forward' } | null; filled: (string | null)[]; outlines: { shapeId: string }[] };
  composition: { pieces: { id: string; shapeId: string }[] };
  guideNextFill(): void;
  select(id: string | null): void;
};

const SHOTS = process.env.FF_SHOTS || '.playwright-mcp';
const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const guide = (page: Page) => el(page, '.guide');
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const press = (isMobile: boolean, sel: string, page: Page) => (isMobile ? el(page, sel).tap() : el(page, sel).click());

/** Which block buttons show the pulse. */
const hints = (page: Page) => page.evaluate(() => {
  const sr = document.querySelector('fridge-face')!.shadowRoot!;
  return [...sr.querySelectorAll<HTMLElement>('.block button[data-block]')].filter((b) => {
    const p = b.querySelector('.bpulse');
    return b.hasAttribute('data-hint') && !!p && getComputedStyle(p).display !== 'none';
  }).map((b) => b.dataset.block!);
});
const look = (page: Page, which: string) => page.evaluate((which) => {
  const sr = document.querySelector('fridge-face')!.shadowRoot!;
  const b = sr.querySelector<HTMLElement>(`.block [data-block=${which}]`)!;
  const p = b.querySelector<HTMLElement>('.bpulse')!;
  const c = getComputedStyle(p);
  const r = b.getBoundingClientRect();
  return {
    anim: c.animationName, opacity: c.opacity, pe: c.pointerEvents, border: c.borderTopColor, hidden: p.closest('[aria-hidden="true"]') !== null,
    transform: c.transform, label: b.getAttribute('aria-label'),
    hit: sr.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b,
    box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10),
  };
}, which);
const blockBoxes = (page: Page) => page.evaluate(() => [...document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll('.block, .block button')].map((e) => {
  const r = e.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',');
}));

const pausePulse = (page: Page) => page.evaluate(() => {
  for (const p of document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.bpulse')) for (const a of p.getAnimations()) { a.pause(); a.currentTime = 600; }
});
const resumePulse = (page: Page) => page.evaluate(() => {
  for (const p of document.querySelector('fridge-face')!.shadowRoot!.querySelectorAll<HTMLElement>('.bpulse')) for (const a of p.getAnimations()) a.play();
});

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await expect(guide(page)).toHaveAttribute('data-welcome', '', { timeout: 5000 });
  await el(page, '.guide [data-guide=yes]').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '1', { timeout: 5000 });
}

async function toStep4(page: Page) {
  await page.evaluate(() => { const ff = document.querySelector('fridge-face') as FF; for (let i = 0; i < 3; i++) ff.guideNextFill(); });
  await expect(guide(page)).toHaveAttribute('data-step', '4');
  await expect(guide(page)).toHaveAttribute('data-target', 'action');
  await frames(page);
}

test('the pulse on Bring forward at c step 4; none before, after or with the guide off; screenshot', async ({ page, isMobile }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, '/?n=bh');
  expect(await hints(page), 'step 1: none').toEqual([]);
  await toStep4(page);
  await expect(guide(page)).toHaveAttribute('data-action', 'forward');
  expect(await hints(page), 'step 4: Forward').toEqual(['forward']);
  expect(await look(page, 'forward')).toMatchObject({ anim: 'ff-block-pulse', pe: 'none', border: 'rgb(55, 138, 221)', hidden: true, label: 'Bring forward', hit: true });
  await frames(page);
  await pausePulse(page);
  await page.screenshot({ path: `${SHOTS}/v165-${info.project.name}-step4.png` });
  await resumePulse(page);

  // The press resolves the step: the pulse goes with the prompt.
  await press(isMobile, '.block [data-block=forward]', page);
  await expect.poll(async () => (await hints(page)).length, { timeout: 5000 }).toBe(0);
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  expect(await hints(page), 'step 5: none').toEqual([]);

  // Guide off: none.
  await el(page, '.gbar [data-gbar=exit]').dispatchEvent('click').catch(() => {});
  await frames(page);
  expect(await hints(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the word\'s stacking prompts: the pulse is on the button the prompt names (Back and Forward)', async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, '/?n=bhw');
  await page.evaluate(() => { const ff = document.querySelector('fridge-face') as FF; for (let i = 0; i < 4; i++) ff.guideNextFill(); });
  await expect(guide(page)).toHaveAttribute('data-step', '5');
  await el(page, '.guide [data-guide=word]').dispatchEvent('click');
  await expect(guide(page)).toHaveAttribute('data-step', '6');
  await page.evaluate(() => { const ff = document.querySelector('fridge-face') as FF; for (let i = 0; i < 12; i++) ff.guideNextFill(); });
  await frames(page);
  expect(await hints(page), 'word, no prompt: none').toEqual([]);

  const seen = new Set<string>();
  // Mis-stack a pair both ways: Bring a placed lower piece forward past an opposite-colour partner, or send a placed upper one back.
  for (const mode of ['forward', 'backward'] as const) {
    for (let attempt = 0; attempt < 12 && !seen.has(mode === 'forward' ? 'x' : 'y'); attempt++) {
      const picked = await page.evaluate(async ({ mode, attempt }) => {
        const ff = document.querySelector('fridge-face') as FF;
        const { SHAPES } = await import(/* @vite-ignore */ '/src/shapes.ts' as string);
        const { convexIntersect, placeOutline } = await import(/* @vite-ignore */ '/src/selection.ts' as string);
        const hull = (id: string) => (SHAPES as { id: string; hull: unknown }[]).find((x) => x.id === id)!.hull;
        const pol = (id: string) => (SHAPES as { id: string; polarity: string }[]).find((x) => x.id === id)!.polarity;
        const g = ff.guide, ps = ff.composition.pieces;
        const pos = new Map(ps.map((p, k) => [p.id, k]));
        const cands: string[] = [];
        for (let i = 0; i < g.filled.length; i++) {
          const a = g.filled[i];
          if (!a) continue;
          let nxt: number | null = null;
          for (let j = 0; j < g.filled.length; j++) {
            const b = g.filled[j];
            if (j === i || !b) continue;
            const above = pos.get(b)! > pos.get(a)!;
            if ((mode === 'forward') !== above) continue;
            if (!convexIntersect(placeOutline(hull(g.outlines[i].shapeId), g.outlines[i]), placeOutline(hull(g.outlines[j].shapeId), g.outlines[j]))) continue;
            if (nxt === null || (mode === 'forward' ? pos.get(b)! < pos.get(g.filled[nxt]!)! : pos.get(b)! > pos.get(g.filled[nxt]!)!)) nxt = j;
          }
          if (nxt !== null && pol(g.outlines[nxt].shapeId) !== pol(g.outlines[i].shapeId)) cands.push(a);
        }
        if (!cands.length) return false;
        ff.select(cands[attempt % cands.length]);
        return true;
      }, { mode, attempt });
      if (!picked) break;
      await press(isMobile, `.block [data-block=${mode}]`, page);
      await frames(page);
      const st = await page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.stack);
      if (st) {
        const action = st.dir === 'back' ? 'backward' : 'forward';
        await expect(guide(page)).toHaveAttribute('data-target', 'action');
        expect(await hints(page), `prompt ${st.dir}`).toEqual([action]);
        seen.add(action);
        // Resolve it by the pulsing button; the pulse goes.
        let guard = 0;
        while ((await page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.stack)) && guard++ < 20) {
          const s = await page.evaluate(() => (document.querySelector('fridge-face') as FF).guide.stack!);
          const a = s.dir === 'back' ? 'backward' : 'forward';
          expect(await hints(page)).toEqual([a]);
          await press(isMobile, `.block [data-block=${a}]`, page);
          await frames(page);
        }
        await expect.poll(() => hints(page), { message: 'prompt answered: none', timeout: 3000 }).toEqual([]);
        break;
      }
    }
  }
  expect([...seen].length, `saw prompts for ${[...seen]}`).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: 'seen', description: [...seen].join(',') });
});

test('a pulse leaves the block\'s layout alone (same boxes with and without it)', async ({ page }) => {
  await open(page, '/?n=bhbox');
  const off = await blockBoxes(page);
  await toStep4(page);
  expect(await hints(page)).toEqual(['forward']);
  expect(await blockBoxes(page)).toEqual(off);
});

test('reduced motion: the block pulse is steady (not animated)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/?n=bhrm');
  await toStep4(page);
  expect(await hints(page)).toEqual(['forward']);
  const l = await look(page, 'forward');
  expect(l).toMatchObject({ anim: 'none', opacity: '1' });
  expect(l.transform, 'spread out from the button, so it shows').not.toBe('none');
  expect(l.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
});
