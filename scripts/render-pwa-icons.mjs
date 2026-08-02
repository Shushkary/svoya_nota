import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const source = pathToFileURL(resolve(root, 'public', 'icon.svg')).toString();
const browser = await chromium.launch();

try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: size, height: size },
    });
    await page.goto(source, { waitUntil: 'load' });
    await page.waitForSelector('svg > circle');
    await page.evaluate(
      () =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
        ),
    );
    await page.screenshot({
      animations: 'disabled',
      omitBackground: true,
      path: resolve(root, 'public', `icon-${size}.png`),
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('PWA icons rendered from public/icon.svg');
