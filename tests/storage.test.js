import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

const {
  corruptJournalBackup, exportJson, freshJournalAfterRecovery, loadJournal, newClientId, saveJournal, upsertEntry, wipeJournal,
} = await import('../src/infrastructure/storage.js');

beforeEach(() => store.clear());

test('идентификатор записи создаётся без Web Crypto', () => {
  const id = newClientId(() => undefined);
  assert.match(id, /^\d+-0\./);
});

test('структурно повреждённый журнал не ломает очередь и сохраняет валидные записи', () => {
  store.set('nota.journal.v1', JSON.stringify({
    token: 123,
    settings: 'broken',
    entries: {
      meal: {
        good: { kind: 'meal', clientId: 'good', at: '2026-07-22', payload: { kcal: 100 } },
        badAt: { kind: 'meal', clientId: 'badAt', at: null, payload: { kcal: 100 } },
        badRevision: { kind: 'meal', clientId: 'badRevision', at: '2026-07-22', updatedAt: 'not-a-date', payload: { kcal: 100 } },
        bad: null,
      },
      state: [],
    },
    outbox: [
      { kind: 'meal', clientId: 'good' }, { kind: 'meal', clientId: 'good' }, null,
      { kind: 'meal', clientId: 'bad' },
    ],
  }));

  const journal = loadJournal();

  assert.equal(journal.token, null);
  assert.equal(journal.entries.meal.good.payload.kcal, 100);
  assert.equal(journal.entries.meal.badAt, undefined);
  assert.equal(journal.entries.meal.badRevision.updatedAt, undefined);
  assert.deepEqual(journal.entries.state, {});
  assert.deepEqual(journal.outbox, [{ kind: 'meal', clientId: 'good' }]);
});

test('экспорт сохраняет текущие записи из памяти для восстановления после ошибки хранилища', () => {
  const exported = JSON.parse(exportJson({ entries: { meal: { one: { payload: { kcal: 100 } } } } }));

  assert.equal(exported.entries.meal.one.payload.kcal, 100);
  assert.match(exported.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('полная очистка удаляет все пользовательские локальные данные приложения', () => {
  const appKeys = [
    'nota.journal.v1', 'nota.journal.v1.corrupt', 'nota.body.v1', 'nota.weight.v1', 'nota.nutrition.v1',
    'nota.nutrition.forecast.v1', 'nota.prefs.v1', 'nota.torion.v1', 'nota_ref',
    'nota.phone-steps.v1', 't_history', 't_bio', 't_theme',
  ];
  appKeys.forEach((key) => store.set(key, 'personal'));
  store.set('nota_admin_token', 'separate-admin-session');

  wipeJournal();

  appKeys.forEach((key) => assert.equal(store.has(key), false, `${key} должен быть удалён`));
  assert.equal(store.get('nota_admin_token'), 'separate-admin-session');
});

test('повреждённый журнал сохраняется отдельно и не перезаписывается пустыми данными', () => {
  store.set('nota.journal.v1', '{not-json');

  const journal = loadJournal();

  assert.equal(journal.recovery.corrupted, true);
  assert.equal(corruptJournalBackup(), '{not-json');
  assert.equal(saveJournal(journal), false);
  assert.equal(store.get('nota.journal.v1'), '{not-json');
  assert.deepEqual(freshJournalAfterRecovery().entries, {
    state: {}, practice: {}, meal: {}, will: {}, activity: {}, profile: {}, ritual: {},
  });
});

test('каждое локальное изменение получает отдельную ревизию updatedAt', () => {
  const journal = { entries: { meal: {} }, outbox: [] };
  const { entry } = upsertEntry(journal, 'meal', { kcal: 100 }, '2026-07-22T10:00:00Z', 'meal-1');
  const { entry: updated } = upsertEntry(
    { ...journal, entries: { meal: { 'meal-1': entry } } },
    'meal', { kcal: 200 }, '2026-07-22T10:00:00Z', 'meal-1',
  );

  assert.match(entry.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(updated.updatedAt > entry.updatedAt);
});

test('редактирование не понижает ревизию после перезагрузки или отката часов', () => {
  const futureRevision = '2099-01-01T00:00:00.000Z';
  const { entry } = upsertEntry(
    { entries: { meal: { 'meal-1': { updatedAt: futureRevision } } }, outbox: [] },
    'meal', { kcal: 100 }, '2026-07-22T10:00:00Z', 'meal-1',
  );

  assert.ok(entry.updatedAt > futureRevision);
});
