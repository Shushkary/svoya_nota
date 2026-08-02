const { chromium } = require('playwright');

const targetUrl = process.argv[2] || 'http://127.0.0.1:4174/svoya-nota-app/';
let browser;

(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  const fixture = await page.evaluate(() => {
    const now = new Date();
    const future = new Date(now);
    future.setHours(17, 18, 0, 0);
    if (future <= now) future.setTime(now.getTime() + 30 * 60_000);
    const clientId = 'regression-future-sausage';
    const journal = JSON.parse(localStorage.getItem('nota.journal.v1') || 'null') || {
      token: null, settings: { aiConsent: false }, entries: {}, outbox: [],
    };
    journal.entries ||= {};
    journal.entries.meal = {
      [clientId]: {
        kind: 'meal', clientId, at: future.toISOString(), updatedAt: now.toISOString(),
        payload: {
          description: 'колбаса варёная', kcal: 250, proteinG: 12, fatG: 20, carbG: 2,
          fiberG: 0, sodiumMg: 1100, potassiumMg: 105, magnesiumMg: 23,
          mealHour: future.getHours() + future.getMinutes() / 60,
          mealType: 'перекус', digestionH: 3, source: 'manual', deleted: false,
        },
      },
    };
    journal.outbox = [];
    localStorage.setItem('nota.journal.v1', JSON.stringify(journal));
    return { futureLabel: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}` };
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Тело/i }).click();
  await page.waitForTimeout(600);
  const row = page.locator('.n-meal-row', { hasText: 'колбаса варёная' });
  const rowVisible = await row.isVisible();
  const futureLoadText = await page.locator('.nutrition-state').innerText();
  await row.getByTitle('Поправить').click();
  const timeInput = page.getByLabel('Время приёма');
  const editTime = await timeInput.inputValue();
  const maxTime = await timeInput.getAttribute('max');
  await timeInput.fill(fixture.futureLabel);
  await page.getByRole('button', { name: 'Сохранить приём' }).click();
  const clampNoticeVisible = await page.getByText(/Будущее время заменено текущим/).isVisible();
  await page.waitForTimeout(300);
  const currentLoadText = await page.locator('.nutrition-state').innerText();
  const correctedRowText = await page.locator('.n-meal-row', { hasText: 'колбаса варёная' }).innerText();
  await page.screenshot({ path: 'C:/tmp/nota-future-sausage-corrected.png', fullPage: true });
  const result = { rowVisible, futureLoadText, editTime, maxTime, clampNoticeVisible, currentLoadText, correctedRowText };
  console.log(JSON.stringify(result, null, 2));
  if (!rowVisible || !/нет активной нагрузки/i.test(futureLoadText)) throw new Error(`future meal affected toroid: ${JSON.stringify(result)}`);
  if (!maxTime || editTime > maxTime) throw new Error(`edit time is not clamped: ${JSON.stringify(result)}`);
  if (!clampNoticeVisible || !/нагрузка \d+%/i.test(currentLoadText)) throw new Error(`corrected meal is not on toroid: ${JSON.stringify(result)}`);
  await browser.close();
  browser = null;
})().catch(async (error) => {
  if (browser) await browser.close().catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
