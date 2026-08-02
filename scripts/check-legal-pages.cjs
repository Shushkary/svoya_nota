const { chromium } = require('playwright');

const baseUrl = (process.argv[2] || process.env.NOTA_URL || 'http://127.0.0.1:5173/').replace(/\/?$/, '/');
const pages = [
  ['pricing.html', /Дневник питания без обязательной подписки/, 'C:/tmp/nota-pricing-mobile.png'],
  ['license.html', /Лицензионное соглашение/, 'C:/tmp/nota-license-mobile.png'],
  ['privacy.html', /Политика обработки персональных данных/, 'C:/tmp/nota-privacy-mobile.png'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const failures = [];

  for (const [path, heading, screenshot] of pages) {
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`${path}: ${error.message}`));
    const response = await page.goto(new URL(path, baseUrl).href, { waitUntil: 'networkidle' });
    if (!response || response.status() !== 200) failures.push(`${path}: HTTP ${response?.status() || 'no response'}`);
    if (!(await page.getByRole('heading', { name: heading }).first().isVisible())) failures.push(`${path}: heading is not visible`);
    if ((await page.locator('body').evaluate((node) => node.scrollWidth > node.clientWidth))) failures.push(`${path}: horizontal overflow`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.close();
  }

  await browser.close();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`Legal browser check passed: ${pages.length} mobile pages.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
