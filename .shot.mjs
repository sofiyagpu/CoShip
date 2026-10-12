import { chromium } from '@playwright/test';
const d = process.argv[2];
const b = await chromium.launch({ channel: 'chrome' });
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await p.goto('http://127.0.0.1:5173/');
  await p.waitForTimeout(3500);
  await p.mouse.move(420, 300, { steps: 20 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${d}/v2-${scheme}.png` });
  await p.close();
}
await b.close();
