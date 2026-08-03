const { chromium } = require('playwright');
const targetUrl = process.argv[2] || process.env.NOTA_URL || 'https://torion.shop/svoya-nota-app/';
let browser;

(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.stack || error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`);
  });

  const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'C:/tmp/nota-mobile-home.png', fullPage: true });
  await page.getByLabel('Энергия').fill('4');
  await page.getByRole('button', { name: 'Сохранить отметку' }).click();
  const momentCheckInSaved = await page.getByText('Состояние сейчас сохранено').isVisible();
  await page.getByRole('button', { name: 'Итог дня' }).click();
  await page.getByLabel('Ясность').fill('4');
  await page.getByRole('button', { name: 'Сохранить отметку' }).click();
  const daySummarySaved = await page.getByText('Итог дня сохранён').isVisible();
  await page.getByRole('button', { name: /Тело/i }).click();
  await page.waitForTimeout(400);
  const canvas = page.locator('.nutrition-stage canvas.torus-canvas');
  const torionDefaultVisible = await page.getByText(/Торион · Mineral Matrix/).first().isVisible();
  const nutritionVisible = await canvas.isVisible();
  const nutritionPixels = nutritionVisible
    ? await canvas.evaluate((node) => {
        const ctx = node.getContext('2d');
        if (!ctx || !node.width || !node.height) return 0;
        const data = ctx.getImageData(0, 0, node.width, node.height).data;
        let opaque = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index]) opaque += 1;
        return opaque;
      })
    : 0;
  await page.screenshot({ path: 'C:/tmp/nota-mobile-nutrition.png', fullPage: true });
  const mineralRingTops = await page.locator('.n-rings').nth(1).locator('.n-ring-svg').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top * 10) / 10));
  const mineralRingsAligned = mineralRingTops.length === 4 && Math.max(...mineralRingTops) - Math.min(...mineralRingTops) <= 1;
  await page.locator('.n-ring-btn', { hasText: 'белки' }).click();
  const proteinFormulaVisible = await page.getByText(/1,6 г × кг расчётной безжировой массы/).isVisible();
  await page.getByRole('button', { name: '← Закрыть' }).click();
  await page.locator('.lowcarb button').click();
  await page.locator('.n-ring-btn', { hasText: 'натрий' }).click();
  const lowCarbSodiumVisible = await page.getByText(/2300 мг как верхний ориентир/).isVisible();
  await page.getByRole('button', { name: '← Закрыть' }).click();
  await page.getByRole('button', { name: /Вручную/ }).click();
  await page.getByRole('searchbox', { name: 'Продукт', exact: true }).fill('яблоко');
  await page.locator('.food-results button').first().click();
  await page.getByLabel('Порция, г').fill('150');
  const catalogSourceVisible = await page.locator('.food-sources a').first().isVisible();
  await page.getByRole('button', { name: 'Добавить продукт в блюдо' }).click();
  const catalogAutofillWorks = Boolean(await page.getByLabel('Состав блюда').inputValue())
    && Number(await page.getByLabel('Ккал').inputValue()) > 0
    && Number(await page.getByLabel('Калий, мг').inputValue()) > 0;
  await page.getByRole('button', { name: '← Закрыть' }).click();
  await page.getByRole('button', { name: /Вручную/ }).click();
  await page.getByLabel('Состав блюда').fill('Гречка с курицей, 300 г');
  await page.getByLabel('Ккал').fill('420');
  await page.getByLabel('Белки, г').fill('32');
  await page.getByLabel('Жиры, г').fill('11');
  await page.getByLabel('Углеводы, г').fill('49');
  await page.getByRole('button', { name: 'Сохранить приём' }).click();
  const manualMealSaved = await page.getByText(/Гречка с курицей, 300 г/).isVisible();
  await page.locator('.n-meal-row', { hasText: 'Гречка с курицей, 300 г' }).getByTitle('Поправить').click();
  const mealRecalculationAvailable = await page.getByRole('button', { name: 'Пересчитать КБЖУ и минералы' }).isVisible();
  await page.getByRole('button', { name: 'Пересчитать КБЖУ и минералы' }).click();
  const mealRecalculationConsentGuard = await page.getByText(/Для пересчёта включите согласие/).isVisible();
  await page.getByRole('button', { name: '← Закрыть' }).click();
  await page.locator('.n-meal-row', { hasText: 'Гречка с курицей, 300 г' }).getByTitle('Повторить с другой порцией').click();
  await page.getByRole('button', { name: 'Полторы' }).click();
  await page.getByRole('button', { name: 'Добавить повтор' }).click();
  const repeatedMealSaved = await page.locator('.n-meal-row', { hasText: /Гречка с курицей, 300 г.*630 ккал/ }).count() === 1;
  await page.locator('.n-meal-row', { hasText: /Гречка с курицей, 300 г.*630 ккал/ }).getByTitle('Повторить с другой порцией').click();
  await page.getByRole('button', { name: 'Добавить повтор' }).click();
  const threeMealsSaved = await page.locator('.n-meal-row', { hasText: 'Гречка с курицей, 300 г' }).count() === 3;
  // Имитируем сброс transform backing-store, который встречается в мобильных WebView
  // после удлинения страницы. Следующий кадр обязан восстановить DPR и центр рисунка.
  await canvas.evaluate((node) => node.getContext('2d')?.setTransform(1, 0, 0, 1, 0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'C:/tmp/nota-mobile-nutrition-three-meals.png', fullPage: true });
  const nutritionCanvasMetrics = await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const ctx = node.getContext('2d');
    const pixels = ctx?.getImageData(0, 0, node.width, node.height).data;
    let minX = node.width; let minY = node.height; let maxX = -1; let maxY = -1;
    if (pixels) {
      for (let y = 0; y < node.height; y += 1) for (let x = 0; x < node.width; x += 1) {
        if (pixels[(y * node.width + x) * 4 + 3] > 8) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    const drawingCenter = maxX >= minX
      ? { x: (minX + maxX) / 2 / node.width, y: (minY + maxY) / 2 / node.height }
      : null;
    return {
      cssWidth: Math.round(rect.width), cssHeight: Math.round(rect.height),
      bitmapWidth: node.width, bitmapHeight: node.height,
      drawingCenter,
    };
  });
  const nutritionCanvasCentered = Boolean(nutritionCanvasMetrics.drawingCenter)
    && Math.abs(nutritionCanvasMetrics.drawingCenter.x - 0.5) < 0.12
    && Math.abs(nutritionCanvasMetrics.drawingCenter.y - 0.5) < 0.12;
  // Переносим тестовые приёмы на вчера и удаляем два подряд. Оставшаяся
  // строка должна сохранить активную кнопку после каждого подтверждения.
  await page.evaluate(() => {
    const key = 'nota.journal.v1';
    const journal = JSON.parse(localStorage.getItem(key));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    for (const entry of Object.values(journal.entries?.meal || {})) {
      const at = new Date(entry.at);
      yesterday.setHours(at.getHours(), at.getMinutes(), 0, 0);
      entry.at = yesterday.toISOString();
    }
    localStorage.setItem(key, JSON.stringify(journal));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Тело/i }).click();
  const yesterdayDeleteButtons = page.getByTitle('Удалить из вчерашних приёмов');
  const yesterdayMealsReady = await yesterdayDeleteButtons.count() === 3;
  await yesterdayDeleteButtons.first().click();
  await page.getByRole('button', { name: 'Удалить блюдо' }).click();
  await page.getByTitle('Удалить из вчерашних приёмов').first().click();
  await page.getByRole('button', { name: 'Удалить блюдо' }).click();
  const yesterdayMealsRemainInteractive = await page.getByTitle('Удалить из вчерашних приёмов').count() === 1
    && await page.getByTitle('Удалить из вчерашних приёмов').isEnabled();
  const activityPanel = page.locator('.n-panel').filter({ hasText: 'активность и расход' });
  await activityPanel.getByRole('button', { name: 'Рекомендации по активности и питанию' }).click();
  const activityTipsVisible = await page.getByRole('heading', { name: 'Мягкие ориентиры на каждый день' }).isVisible()
    && await page.getByRole('link', { name: /ВОЗ: физическая активность/ }).isVisible();
  await page.getByRole('button', { name: '← Закрыть' }).click();
  const activityStartMinute = Number(await activityPanel.locator('input[type="range"]').nth(1).inputValue());
  const browserMinute = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  const activityStartsNow = Math.abs(activityStartMinute - browserMinute) <= 2;
  await activityPanel.getByRole('button', { name: 'Добавить активность вручную' }).click();
  const activityRow = activityPanel.locator('.n-meal-row', { hasText: 'ходьба (бодро)' });
  await activityRow.getByTitle('Поправить').click();
  await activityPanel.locator('select').selectOption('yoga');
  await activityPanel.getByRole('button', { name: 'Сохранить активность' }).click();
  const activityEditSaved = await activityPanel.locator('.n-meal-row', { hasText: 'йога' }).isVisible();
  await page.getByLabel('Фактические шаги').fill('7654');
  await page.getByRole('button', { name: 'Сохранить шаги' }).click();
  const quickActivitySaved = await page.getByText(/7.?654 шагов.*дневной итог/i).isVisible();
  await page.getByRole('button', { name: /Сегодня/i }).click();
  const stepsTransferredToToday = await page.getByText(/Сегодня: 7.?654 шагов/i).isVisible();
  await page.getByRole('button', { name: /Практика/i }).click();
  await page.getByRole('button', { name: /Солнечное сплетение/i }).click();
  await page.waitForTimeout(400);
  const practiceCanvas = page.locator('.center-stage-old canvas.torus-canvas');
  const practiceVisible = await practiceCanvas.isVisible();
  const practicePixels = practiceVisible
    ? await practiceCanvas.evaluate((node) => {
        const ctx = node.getContext('2d');
        if (!ctx || !node.width || !node.height) return 0;
        const data = ctx.getImageData(0, 0, node.width, node.height).data;
        let opaque = 0;
        for (let index = 3; index < data.length; index += 4) if (data[index]) opaque += 1;
        return opaque;
      })
    : 0;
  await page.screenshot({ path: 'C:/tmp/nota-mobile-practice.png', fullPage: true });
  await page.getByRole('button', { name: 'Поехали' }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Остановка' }).click();
  const practiceSaved = !(await page.locator('.center-stage-old canvas.torus-canvas').isVisible());
  await page.getByRole('button', { name: /Солнечное сплетение/i }).click();
  await page.getByRole('button', { name: 'Полно' }).click();
  await page.locator('.center-field select').selectOption('tap');
  const pulseButton = page.getByRole('button', { name: 'Удар ♥' });
  for (let index = 0; index < 4; index += 1) {
    await pulseButton.click();
    if (index < 3) await page.waitForTimeout(700);
  }
  const pulseMeasured = /\d+ уд\/мин/.test(await page.locator('.center-biolive').innerText());
  await page.getByRole('button', { name: /Назад в практику/ }).click();
  await page.getByRole('button', { name: /Динамика/i }).click();
  const explainableInsightsVisible = await page.getByText(/Дней с обеими записями:.*из минимум.*Сравнение:/).first().isVisible();
  await page.getByRole('button', { name: /Практика/i }).click();
  await page.getByRole('button', { name: /практики раздела/i }).first().click();
  await page.getByRole('button', { name: /Дыхание по методу Вима Хофа/i }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const audioVisible = await page.locator('audio').isVisible()
    && await page.locator('audio source[src$="wim-hof-breathing.mp3"]').count() === 1;
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(targetUrl, { waitUntil: 'networkidle' });
  await desktopPage.getByRole('button', { name: /Тело/i }).click();
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: 'C:/tmp/nota-desktop-nutrition.png', fullPage: true });
  await desktopPage.getByRole('button', { name: /Практика/i }).click();
  await desktopPage.getByRole('button', { name: /Солнечное сплетение/i }).click();
  await desktopPage.getByRole('button', { name: 'Полно' }).click();
  await desktopPage.screenshot({ path: 'C:/tmp/nota-desktop-practice-full.png', fullPage: true });
  await desktop.close();
  if (failures.length) throw new Error(failures.join('\n'));
  if (!mineralRingsAligned || !proteinFormulaVisible || !lowCarbSodiumVisible || !catalogSourceVisible || !catalogAutofillWorks || !mealRecalculationAvailable || !mealRecalculationConsentGuard || !threeMealsSaved || !nutritionCanvasCentered || !yesterdayMealsReady || !yesterdayMealsRemainInteractive || !torionDefaultVisible || !activityTipsVisible || !activityStartsNow || !activityEditSaved || !quickActivitySaved || !stepsTransferredToToday) {
    throw new Error(`nutrition regression: rings=${mineralRingsAligned}/${mineralRingTops.join(',')}, targets=${proteinFormulaVisible}/${lowCarbSodiumVisible}, catalog=${catalogSourceVisible}/${catalogAutofillWorks}, recalculation=${mealRecalculationAvailable}/${mealRecalculationConsentGuard}, threeMealsSaved=${threeMealsSaved}, centered=${nutritionCanvasCentered}, yesterdayDelete=${yesterdayMealsReady}/${yesterdayMealsRemainInteractive}, torionDefaultVisible=${torionDefaultVisible}, activityTipsVisible=${activityTipsVisible}, activityStartsNow=${activityStartsNow}, activityEditSaved=${activityEditSaved}, quickActivitySaved=${quickActivitySaved}, stepsTransferredToToday=${stepsTransferredToToday}`);
  }
  console.log(JSON.stringify({
    status: response.status(), failures, nutritionVisible, nutritionPixels, practiceVisible, practicePixels,
    momentCheckInSaved, daySummarySaved, mineralRingTops, mineralRingsAligned, proteinFormulaVisible, lowCarbSodiumVisible, catalogSourceVisible, catalogAutofillWorks, manualMealSaved, mealRecalculationAvailable, mealRecalculationConsentGuard, repeatedMealSaved, threeMealsSaved,
    nutritionCanvasMetrics, nutritionCanvasCentered, yesterdayMealsReady, yesterdayMealsRemainInteractive, torionDefaultVisible, activityTipsVisible, activityStartsNow, activityEditSaved, quickActivitySaved, stepsTransferredToToday, audioVisible, practiceSaved, pulseMeasured, explainableInsightsVisible,
  }, null, 2));
  await browser.close();
  browser = null;
})().catch(async (error) => {
  if (browser) await browser.close().catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
