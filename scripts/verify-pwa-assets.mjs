import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function pngDimensions(fileName) {
  const bytes = await readFile(resolve(publicDir, fileName));
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`${fileName}: неверная PNG-сигнатура`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${fileName}: отсутствует IHDR`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const manifest = JSON.parse(
  await readFile(resolve(publicDir, 'manifest.webmanifest'), 'utf8'),
);

for (const [fileName, expected] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const { width, height } = await pngDimensions(fileName);
  if (width !== expected || height !== expected) {
    throw new Error(
      `${fileName}: ожидалось ${expected}x${expected}, получено ${width}x${height}`,
    );
  }
}

for (const icon of manifest.icons || []) {
  await readFile(resolve(publicDir, icon.src));
}

if (manifest.lang !== 'ru' || manifest.display !== 'standalone') {
  throw new Error('manifest.webmanifest: неверные lang/display');
}

console.log('PWA assets: OK (PNG 192x192, PNG 512x512, manifest icons found)');
