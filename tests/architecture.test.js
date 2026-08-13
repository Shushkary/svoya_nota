import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return /\.(?:js|jsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

function importsOf(source) {
  return [...source.matchAll(/(?:import\s+(?:[^'\"]+\s+from\s+)?|export\s+[^'\"]+\s+from\s+)[\"']([^\"']+)[\"']/g)]
    .map((match) => match[1]);
}

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('domain не зависит от UI, application, infrastructure и браузера', async () => {
  const files = await javascriptFiles(path.join(ROOT, 'src', 'domain'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const executable = executableSource(source);
    for (const imported of importsOf(source)) {
      assert.ok(!/(?:^react$|[\\/]ui[\\/]|[\\/]application[\\/]|[\\/]infrastructure[\\/])/.test(imported),
        `${path.relative(ROOT, file)} imports forbidden ${imported}`);
    }
    assert.ok(!/\b(?:window|document|localStorage|sessionStorage|navigator|fetch)\b/.test(executable),
      `${path.relative(ROOT, file)} uses a browser adapter directly`);
  }
});

test('infrastructure не зависит от ui и application', async () => {
  // Адаптеры обязаны оставаться заменяемыми: знание о представлении или
  // сценариях делает подмену хранилища/сети невозможной без правок в UI.
  const files = await javascriptFiles(path.join(ROOT, 'src', 'infrastructure'));
  assert.ok(files.length > 0, 'слой infrastructure не найден');
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const imported of importsOf(source)) {
      assert.ok(!/(?:^react$|[\\/]ui[\\/]|[\\/]application[\\/])/.test(imported),
        `${path.relative(ROOT, file)} imports forbidden ${imported}`);
    }
  }
});

test('имена ключей localStorage объявлены только в domain/keys.js', async () => {
  // Единственный источник истины: иначе «удалить все данные» однажды пропустит
  // ключ, и личные записи останутся на устройстве без способа их убрать.
  const files = [
    ...await javascriptFiles(path.join(ROOT, 'src', 'infrastructure')),
    ...await javascriptFiles(path.join(ROOT, 'src', 'application')),
  ];
  for (const file of files) {
    const executable = executableSource(await readFile(file, 'utf8'));
    const literals = [...executable.matchAll(/['"`](nota\.[\w.]+)['"`]/g)].map((m) => m[1]);
    assert.deepEqual(literals, [],
      `${path.relative(ROOT, file)} объявляет ключ ${literals[0]} вне domain/keys.js`);
  }
});

test('domain/rhythm/* не участвует в вычислении полярности состояния', async () => {
  // Инвариант: ни одна функция не должна принимать время суток и
  // возвращать ожидаемое состояние человека. stateCheckIn.js — единственное
  // место, где считается полярность (расширение/собранность), — не должен
  // знать о фазе дня, иначе часы начнут предсказывать самочувствие.
  const source = await readFile(path.join(ROOT, 'src', 'domain', 'stateCheckIn.js'), 'utf8');
  for (const imported of importsOf(source)) {
    assert.ok(!/[\\/]rhythm[\\/]/.test(imported),
      `stateCheckIn.js импортирует ${imported} — время суток не должно участвовать в вычислении состояния`);
  }
});

test('application зависит только от domain и переданных портов', async () => {
  const files = await javascriptFiles(path.join(ROOT, 'src', 'application'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const executable = executableSource(source);
    for (const imported of importsOf(source)) {
      assert.ok(!/(?:^react$|[\\/]ui[\\/]|[\\/]infrastructure[\\/])/.test(imported),
        `${path.relative(ROOT, file)} imports forbidden ${imported}`);
    }
    assert.ok(!/\b(?:window|document|localStorage|sessionStorage|navigator|fetch)\b/.test(executable),
      `${path.relative(ROOT, file)} uses a browser adapter directly`);
  }
});
