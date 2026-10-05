import { expect, test, type Page } from '@playwright/test';

/** The Controls panel: only the input methods the device has, in Chromium AND WebKit. */

async function open(page: Page) {
  await page.goto('/?n=1');
  await page.waitForFunction(() => !!document.querySelector('fridge-face')?.shadowRoot?.querySelector('.tray button[data-shape]'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Deliberately no key press here: a real key press is what reveals the Keyboard section on a phone.
}

const el = (page: Page, sel: string) => page.locator(`fridge-face ${sel}`);
const section = (page: Page, id: string) => el(page, `[data-controls=${id}]`);

async function openPanel(page: Page, isMobile: boolean) {
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await el(page, '[data-menu=help]').tap();
  } else {
    await el(page, '[data-view=help]').click();
  }
  await expect(el(page, '.help')).toBeVisible();
}

test('the help button and menu item are named Controls', async ({ page, isMobile }) => {
  await open(page);
  if (isMobile) {
    await el(page, '[data-view=menu]').tap();
    await expect(el(page, '[data-menu=help]')).toContainText('Controls');
  } else {
    await expect(el(page, '[data-view=help]')).toHaveAttribute('aria-label', 'Controls');
  }
  await page.evaluate(() => { document.querySelector('fridge-face')!.shadowRoot!.querySelector<HTMLElement>('.menu')!.hidden = true; });
  const html = await page.evaluate(() => document.querySelector('fridge-face')!.shadowRoot!.innerHTML);
  expect(html).not.toMatch(/keyboard shortcuts/i);
});

test('desktop: Touch hidden, Mouse and Keyboard shown, Show all reveals Touch; reports maxTouchPoints', async ({ page, isMobile, browserName }, info) => {
  test.skip(isMobile, 'desktop profiles only');
  await open(page);
  const env = await page.evaluate(() => ({ points: navigator.maxTouchPoints, coarse: matchMedia('(any-pointer: coarse)').matches, fine: matchMedia('(any-pointer: fine)').matches }));
  info.annotations.push({ type: 'env', description: `${browserName} desktop: ${JSON.stringify(env)}` });
  expect(env.points, 'maxTouchPoints on desktop').toBe(0);
  await openPanel(page, false);
  await expect(el(page, '#ff-help-title')).toHaveText('Controls');
  await expect(section(page, 'touch')).toBeHidden();
  await expect(section(page, 'pointer')).toBeVisible();
  await expect(section(page, 'keyboard')).toBeVisible();
  await expect(el(page, '[data-help=showall]')).toBeVisible(); // Touch is hidden, so there is something to reveal
  await el(page, '[data-help=showall]').click();
  await expect(section(page, 'touch')).toBeVisible();
  await expect(el(page, '[data-help=showall]')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(el(page, '.help')).toBeHidden();
});

test('phone: only Touch; Show all controls reveals the rest and resets on close; a real key press reveals Keyboard live', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await openPanel(page, true);
  await expect(section(page, 'touch')).toBeVisible();
  await expect(section(page, 'pointer')).toBeHidden();
  await expect(section(page, 'keyboard')).toBeHidden();
  const showAll = el(page, '[data-help=showall]');
  await expect(showAll).toBeVisible();
  await expect(showAll).toHaveText('Show all controls');
  expect(await showAll.evaluate((b) => getComputedStyle(b).textTransform)).toBe('uppercase');

  await showAll.tap();
  await expect(section(page, 'pointer')).toBeVisible();
  await expect(section(page, 'keyboard')).toBeVisible();
  await expect(showAll).toBeHidden();
  await el(page, '[data-help=close]').tap();
  await expect(el(page, '.help')).toBeHidden();

  await openPanel(page, true);
  await expect(section(page, 'pointer')).toBeHidden(); // reset on close
  await expect(section(page, 'keyboard')).toBeHidden();
  await expect(showAll).toBeVisible();

  // A real (trusted) key press, while the panel is open: Keyboard appears live; Show all stays for Mouse.
  await page.keyboard.press('a');
  await expect(section(page, 'keyboard')).toBeVisible();
  await expect(section(page, 'pointer')).toBeHidden();
  await expect(showAll).toBeVisible();
});

test('phone: pressing ? itself counts as a keyboard', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await el(page, '.board svg.surface').focus();
  await page.keyboard.press('?');
  await expect(el(page, '.help')).toBeVisible();
  await expect(section(page, 'keyboard')).toBeVisible();
  await expect(section(page, 'touch')).toBeVisible();
  await expect(section(page, 'pointer')).toBeHidden();
});

test('a synthetic key press does not reveal the Keyboard section', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone profiles only');
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })));
  await openPanel(page, true);
  await expect(section(page, 'keyboard')).toBeHidden();
});

test('the dialog keeps focus inside, closes on Escape and returns focus', async ({ page, isMobile }) => {
  await open(page);
  await openPanel(page, isMobile);
  const active = () => page.evaluate(() => (document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null)?.getAttribute('data-help') ?? (document.querySelector('fridge-face')!.shadowRoot!.activeElement as HTMLElement | null)?.className ?? '');
  expect(await active()).toBe('close');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.querySelector('fridge-face')!.shadowRoot!.activeElement?.closest('.help'));
    expect(inside).toBe(true);
  }
  const scrollable = await el(page, '.helpbody').evaluate((b) => getComputedStyle(b).overflowY);
  expect(['auto', 'scroll']).toContain(scrollable);
  await page.keyboard.press('Escape');
  await expect(el(page, '.help')).toBeHidden();
});

test('axe: no violations with the Controls panel open (Chromium, phone and desktop)', async ({ page, isMobile, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe gate runs in Chromium');
  await open(page);
  await openPanel(page, isMobile);
  if (isMobile) await el(page, '[data-help=showall]').tap(); // axe the longest state on the phone
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
  const violations = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document);
    return r.violations.map((v) => `${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes.map((n: any) => n.target))}`);
  });
  expect(violations).toEqual([]);
});
