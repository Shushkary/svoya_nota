const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:4174/svoya-nota-app/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const failures = [];
  page.on('pageerror', (error) => failures.push(String(error)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  const initialTheme = await page.locator('html').getAttribute('data-theme');
  const trackerImportVisible = await page.getByRole('button', { name: /импортировать CSV/i }).isVisible();
  await page.screenshot({ path: 'C:/tmp/nota-dark-theme.png', fullPage: true });

  await page.getByRole('button', { name: 'Тело' }).click();
  const bodyToroidBackground = await page.locator('.nutrition-stage').evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  await page.getByRole('button', { name: 'Практика' }).click();
  await page.getByRole('button', { name: /Солнечное сплетение/i }).click();
  const practiceToroidBackground = await page.locator('.center-stage-old').evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );

  await page.getByRole('button', { name: 'Профиль' }).click();
  const dynamicsHasProfile = await page.getByText('Параметры профиля', { exact: true }).count();

  await page.getByRole('button', { name: 'Ещё' }).click();
  const moreProfileCount = await page.getByText('Параметры профиля', { exact: true }).count();
  const bodyCount = await page.getByText('Самонаблюдение тела', { exact: true }).count();

  await page.locator('.theme-toggle').click();
  const toggledTheme = await page.locator('html').getAttribute('data-theme');

  const result = {
    failures,
    initialTheme,
    toggledTheme,
    trackerImportVisible,
    bodyToroidBackground,
    practiceToroidBackground,
    dynamicsHasProfile,
    moreProfileCount,
    bodyCount,
  };
  console.log(JSON.stringify(result, null, 2));
  await browser.close();

  if (
    failures.length
    || initialTheme !== 'dark'
    || toggledTheme !== 'light'
    || !trackerImportVisible
    || bodyToroidBackground === 'rgb(255, 255, 255)'
    || practiceToroidBackground === 'rgb(255, 255, 255)'
    || dynamicsHasProfile !== 0
    || moreProfileCount !== 1
    || bodyCount !== 1
  ) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
