import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const {
  hasPhoneStepsBridge, loadPhoneSteps, loadPhoneStepsMap, readPhoneSteps, savePhoneSteps,
} = await import('../src/infrastructure/phoneSteps.js');

beforeEach(() => store.clear());

test('шаги телефона сохраняются отдельно от журнала и читаются по дате', () => {
  const saved = savePhoneSteps('2026-07-29', 8123, 'Health Connect');
  const loaded = loadPhoneSteps('2026-07-29');
  assert.equal(loaded.steps, 8123);
  assert.equal(loaded.source, 'Health Connect');
  assert.equal(loaded.date, '2026-07-29');
  assert.equal(loaded.updatedAt, saved.updatedAt);
  assert.equal(store.has('nota.journal.v1'), false);
  assert.equal(loadPhoneStepsMap()['2026-07-29'].steps, 8123);
});

test('нативный мост возвращает шаги и источник', async () => {
  const result = await readPhoneSteps('2026-07-29', {
    SvoyaNotaHealth: {
      readDailySteps: async () => ({ steps: 5400, source: 'Apple Health' }),
    },
  });
  assert.deepEqual(result, { supported: true, steps: 5400, source: 'Apple Health' });
});

test('обычный браузер честно сообщает об отсутствии системного API', async () => {
  assert.equal(hasPhoneStepsBridge({}), false);
  assert.deepEqual(
    await readPhoneSteps('2026-07-29', {}),
    { supported: false, reason: 'native_bridge_required' },
  );
});

test('доступность моста определяется до нажатия кнопки', () => {
  assert.equal(hasPhoneStepsBridge({ AndroidHealthConnect: { readTodaySteps() {} } }), true);
});
