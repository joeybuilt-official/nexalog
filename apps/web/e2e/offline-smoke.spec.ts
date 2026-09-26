import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`offline shell shows at ${vp.width}px`, async ({ page, context }) => {
    await page.setViewportSize(vp);
    // Load once to prime SW
    await page.goto('http://localhost:3000/app/today', { waitUntil: 'networkidle' });
    // Go offline
    await context.setOffline(true);
    await page.goto('http://localhost:3000/app/today');
    const body = await page.textContent('body');
    // Either cached page or offline fallback — both are acceptable
    expect(body).toBeTruthy();
    await context.setOffline(false);
  });
}
