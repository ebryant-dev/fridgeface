import { defineConfig, devices } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> }; // runs in Node; the project has no @types/node

/**
 * Real-browser layout checks (`npm run test:browsers`): index.html on the Vite dev server, in Chromium AND WebKit,
 * at a desktop size, an iPhone in portrait and an iPhone in landscape. Unit tests stay in Vitest (`npm test`);
 * these files end in `.pw.ts` so Vitest never picks them up.
 */
const PORT = 5199;
const iphone = devices['iPhone 15'];
const iphoneLandscape = devices['iPhone 15 landscape'];
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
/**
 * The onboarding guide shows on every visit. The suites written before it test other features, so they start with its
 * "Don't show again" stored (FF_GUIDE=on runs them with the guide showing). `guide.pw.ts` clears this for itself.
 */
const guideOff = {
  cookies: [],
  origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'fridgeface:guide:v2', value: 'off' }] }],
};

export default defineConfig({
  testDir: 'tests/browsers',
  testMatch: '**/*.pw.ts',
  outputDir: '.playwright-mcp/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off', storageState: process.env.FF_GUIDE === 'on' ? undefined : guideOff },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'chromium-iphone', use: { ...iphone, browserName: 'chromium' } },
    { name: 'chromium-iphone-landscape', use: { ...iphoneLandscape, browserName: 'chromium' } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop } },
    { name: 'webkit-iphone', use: { ...iphone, browserName: 'webkit' } },
    { name: 'webkit-iphone-landscape', use: { ...iphoneLandscape, browserName: 'webkit' } },
  ],
});
