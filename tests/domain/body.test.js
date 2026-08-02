// Контур «Самонаблюдение тела» — device-only хранилище.
//
// Прежние проверки этого файла относились к домену `src/domain/body.js`
// (WHtR, зоны риска, оценка висцерального жира). Модуль намеренно удалён:
// такие расчёты — медицинские утверждения, запрещённые спецификацией
// «Вариант D» (§2.1), а окружность тела относится к специальной категории ПДн
// (ФЗ-152). Осталось изолированное наблюдение одной величины на устройстве —
// его контракт и проверяем здесь.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

// bodyStorage работает с localStorage — подставляем минимальную реализацию.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => store.clear(),
};

const {
  loadBody, hasConsent, setConsent, addMeasurement,
  removeMeasurement, clearMeasurements, getSeries, BODY_CONSENT_VERSION,
} = await import('../../src/infrastructure/bodyStorage.js');
const { BODY_KEY } = await import('../../src/domain/keys.js');

beforeEach(() => store.clear());

test('до согласия контур пуст и ничего не хранит', () => {
  const state = loadBody();
  assert.equal(hasConsent(state), false);
  assert.deepEqual(state.measurements, []);
});

test('согласие фиксируется с версией — она нужна для повторного запроса', () => {
  const state = setConsent(loadBody(), true);
  assert.equal(hasConsent(state), true);
  assert.equal(state.consent.version, BODY_CONSENT_VERSION);
  assert.ok(state.consent.grantedAt);
});

test('отзыв согласия физически удаляет данные, а не только флаг', () => {
  let state = setConsent(loadBody(), true);
  ({ state } = addMeasurement(state, 82, '2026-07-20T10:00:00.000Z'));
  assert.equal(state.measurements.length, 1);
  assert.ok(store.has(BODY_KEY), 'до отзыва запись в хранилище есть');

  state = setConsent(state, false);
  assert.equal(hasConsent(state), false);
  assert.deepEqual(state.measurements, [], 'замеры удалены');
  assert.equal(store.has(BODY_KEY), false, 'ключ хранилища удалён целиком');
});

test('значения вне разумного диапазона отклоняются с ошибкой, а не сохраняются', () => {
  const state = setConsent(loadBody(), true);
  for (const bad of [0, 29, 301, 'не число', NaN]) {
    const result = addMeasurement(state, bad);
    assert.equal(result.error, 'range', `значение ${bad} должно быть отклонено`);
    assert.equal(result.state.measurements.length, 0);
  }
});

test('запятая как разделитель принимается, значение округляется до 0.1', () => {
  const state = setConsent(loadBody(), true);
  const { entry } = addMeasurement(state, '82,46');
  assert.equal(entry.cm, 82.5);
  assert.equal(entry.source, 'self-report');
});

test('на одну дату остаётся один замер — повторный заменяет прежний', () => {
  let state = setConsent(loadBody(), true);
  ({ state } = addMeasurement(state, 82, '2026-07-20T08:00:00.000Z'));
  ({ state } = addMeasurement(state, 81, '2026-07-20T21:00:00.000Z'));
  ({ state } = addMeasurement(state, 80, '2026-07-21T09:00:00.000Z'));
  assert.equal(state.measurements.length, 2);
  const byDay = getSeries(state).map((m) => [m.at.slice(0, 10), m.cm]);
  assert.deepEqual(byDay, [['2026-07-20', 81], ['2026-07-21', 80]]);
});

test('серия отсортирована по времени независимо от порядка ввода', () => {
  let state = setConsent(loadBody(), true);
  ({ state } = addMeasurement(state, 80, '2026-07-21T09:00:00.000Z'));
  ({ state } = addMeasurement(state, 83, '2026-07-19T09:00:00.000Z'));
  ({ state } = addMeasurement(state, 82, '2026-07-20T09:00:00.000Z'));
  assert.deepEqual(getSeries(state).map((m) => m.cm), [83, 82, 80]);
});

test('удаление одного замера и полная очистка сохраняют согласие', () => {
  let state = setConsent(loadBody(), true);
  const first = addMeasurement(state, 82, '2026-07-20T09:00:00.000Z');
  state = first.state;
  ({ state } = addMeasurement(state, 81, '2026-07-21T09:00:00.000Z'));

  state = removeMeasurement(state, first.entry.id);
  assert.deepEqual(getSeries(state).map((m) => m.cm), [81]);

  state = clearMeasurements(state);
  assert.deepEqual(state.measurements, []);
  assert.equal(hasConsent(state), true, 'очистка замеров — не отзыв согласия');
});

test('данные переживают перезагрузку страницы', () => {
  let state = setConsent(loadBody(), true);
  ({ state } = addMeasurement(state, 82, '2026-07-20T09:00:00.000Z'));
  const reloaded = loadBody();
  assert.equal(hasConsent(reloaded), true);
  assert.deepEqual(getSeries(reloaded).map((m) => m.cm), [82]);
});

test('повреждённое хранилище не роняет приложение', () => {
  store.set(BODY_KEY, '{это не JSON');
  const state = loadBody();
  assert.equal(hasConsent(state), false);
  assert.deepEqual(state.measurements, []);
});

test('контур изолирован: не импортирует журнал и сеть, не пишет в outbox', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/infrastructure/bodyStorage.js', import.meta.url), 'utf8');
  // Комментарии объясняют сам запрет и содержат эти слова — проверяем только код.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Реальные спецификаторы импорта, а не подстроки в произвольном месте файла.
  const imports = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map(([, spec]) => spec);
  assert.ok(imports.length > 0, 'импорты должны разбираться');
  for (const spec of imports) {
    const file = spec.split('/').pop();
    assert.ok(
      !['storage.js', 'api.js'].includes(file),
      `контур не должен импортировать ${spec} — данные попали бы в журнал/сеть`,
    );
  }
  // Ключ журнала и очередь синхронизации не должны упоминаться вовсе.
  for (const forbidden of ['upsertEntry', 'outbox', 'JOURNAL_KEY', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `не ожидалось «${forbidden}»`);
  }
  assert.match(source, /BODY_KEY/, 'используется собственный ключ хранилища');
});
