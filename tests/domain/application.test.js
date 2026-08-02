import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileNutritionJournal } from '../../src/application/nutrition/reconcileJournal.js';
import { solarSessionToEntry } from '../../src/application/practice/session.js';
import { registerDevice, restoreDeviceJournal } from '../../src/application/sync/deviceJournal.js';
import {
  acknowledgeSyncBatch, applySyncConflicts, createSyncBatch, mergeLocalJournal, mergeSnapshot,
  synchronizeJournal,
} from '../../src/application/sync/journalSync.js';

function upsert(journal, kind, payload, at, clientId) {
  return {
    journal: {
      ...journal,
      entries: {
        ...journal.entries,
        [kind]: {
          ...(journal.entries[kind] || {}),
          [clientId]: { kind, clientId, at, payload },
        },
      },
    },
  };
}

test('синхронизация питания идемпотентна и помечает удалённые записи', () => {
  const empty = { entries: { meal: {} } };
  const message = {
    windowStartedAt: 123,
    preserveHistory: false,
    meals: [{ uid: 'one', name: 'Суп', hour: 13.5, kcal: 250, p: 10, f: 8, c: 30 }],
  };
  const first = reconcileNutritionJournal({
    journal: empty, message, upsert, now: new Date(2026, 6, 22, 15, 0, 0),
  });
  assert.equal(Object.keys(first.entries.meal).length, 1);
  assert.equal(first.entries.meal['w-one'].payload.mealType, 'обед');

  const second = reconcileNutritionJournal({
    journal: first, message: { ...message, meals: [] }, upsert,
  });
  assert.equal(Object.keys(second.entries.meal).length, 1);
  assert.equal(second.entries.meal['w-one'].payload.deleted, true);
});

test('сессия центра преобразуется без знания React и хранилища', () => {
  const entry = solarSessionToEntry({
    id: 'abc', date: '2026-07-22T10:00:00.000Z', protocol: 'coherent',
    durationMs: 61_400, breaths: 6, adherence: 0.9, coherence: null, calmDelta: 1,
  });
  assert.equal(entry.clientId, 'solar-abc');
  assert.equal(entry.payload.durationSec, 61);
  assert.equal(entry.payload.form.protocol, 'coherent');
});

test('очередь синхронизации собирается порциями и подтверждается идемпотентно', () => {
  const journal = {
    entries: { meal: {
      one: { kind: 'meal', clientId: 'one', at: '2026-07-22T10:00:00Z', payload: { kcal: 100 } },
      two: { kind: 'meal', clientId: 'two', at: '2026-07-22T11:00:00Z', payload: { kcal: 200 } },
    } },
    outbox: [{ kind: 'meal', clientId: 'one' }, { kind: 'meal', clientId: 'two' }],
  };
  const { batch, entries } = createSyncBatch(journal, 1);
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0].payload), { kcal: 100 });
  assert.equal(entries[0].updatedAt, '2026-07-22T10:00:00Z');
  assert.deepEqual(
    acknowledgeSyncBatch(journal, batch, [{ kind: 'meal', clientId: 'one' }]).outbox,
    [{ kind: 'meal', clientId: 'two' }],
  );
});

test('use case синхронизации зависит только от переданного порта и сохраняет правку в полёте', async () => {
  const journal = {
    entries: { meal: { one: {
      kind: 'meal', clientId: 'one', at: '2026-07-22T10:00:00Z', payload: { kcal: 100 },
    } } },
    outbox: [{ kind: 'meal', clientId: 'one' }],
  };
  let sent;
  const sync = await synchronizeJournal(journal, async (entries) => {
    sent = entries;
    return { accepted: [{ kind: 'meal', clientId: 'one' }], rejected: [] };
  });
  const changed = {
    ...journal,
    entries: { meal: { one: { ...journal.entries.meal.one, payload: { kcal: 200 } } } },
  };

  assert.equal(sent.length, 1);
  assert.deepEqual(sync.apply(changed).outbox, [{ kind: 'meal', clientId: 'one' }]);
});

test('регистрация подключает актуальный журнал и ставит все записи в очередь', async () => {
  const registration = await registerDevice(async () => ({ token: 'device-token' }));
  const journal = {
    settings: { aiConsent: false },
    entries: { meal: { one: {} }, ritual: { r1: {} } },
    outbox: [],
  };

  const connected = registration.apply(journal);
  assert.equal(connected.token, 'device-token');
  assert.equal(connected.settings.backupConsentVersion, '2026-07-28-backup-v1');
  assert.ok(connected.settings.backupConsentAt);
  assert.deepEqual(connected.outbox, [
    { kind: 'meal', clientId: 'one' },
    { kind: 'ritual', clientId: 'r1' },
  ]);
});

test('восстановление через порт не затирает более новую локальную запись', async () => {
  const restore = await restoreDeviceJournal('device-token', async () => ({ entries: [{
    kind: 'meal', clientId: 'one', at: '2026-07-22T10:00:00Z',
    updatedAt: '2026-07-22T10:01:00Z', payload: '{"kcal":100}',
  }] }));
  const journal = { entries: { meal: { one: {
    kind: 'meal', clientId: 'one', at: '2026-07-22T10:00:00Z',
    updatedAt: '2026-07-22T10:02:00Z', payload: { kcal: 200 },
  } } }, outbox: [] };

  assert.equal(restore.apply(journal).entries.meal.one.payload.kcal, 200);
});

test('подтверждение синхронизации не теряет отклонённую или изменённую в полёте запись', () => {
  const journal = {
    entries: { meal: {
      one: { kind: 'meal', clientId: 'one', at: '2026-07-22T10:00:00Z', payload: { kcal: 100 } },
    } },
    outbox: [{ kind: 'meal', clientId: 'one' }],
  };
  const { batch } = createSyncBatch(journal);

  assert.deepEqual(
    acknowledgeSyncBatch(journal, batch, []).outbox,
    [{ kind: 'meal', clientId: 'one' }],
    'серверное отклонение остаётся видимо в outbox',
  );

  const changedWhileSyncing = {
    ...journal,
    entries: { meal: {
      one: { ...journal.entries.meal.one, payload: { kcal: 200 } },
    } },
  };
  assert.deepEqual(
    acknowledgeSyncBatch(changedWhileSyncing, batch, [{ kind: 'meal', clientId: 'one' }]).outbox,
    [{ kind: 'meal', clientId: 'one' }],
    'новая редакция должна быть отправлена отдельным запросом',
  );
});

test('snapshot добавляет только валидные отсутствующие записи', () => {
  const journal = { entries: { meal: {
    local: { kind: 'meal', clientId: 'local', at: '2026-07-22T10:00:00Z', payload: { kcal: 100 } },
  } }, outbox: [] };
  const merged = mergeSnapshot(journal, [
    { kind: 'meal', clientId: 'local', at: 'old', payload: '{"kcal":999}' },
    { kind: 'meal', clientId: 'remote', at: '2026-07-22T11:00:00Z', payload: '{"kcal":200}' },
    { kind: 'meal', clientId: 'broken', at: '2026-07-22T12:00:00Z', payload: '{' },
    { kind: 'unknown', clientId: 'ignored', at: '2026-07-22T12:00:00Z', payload: '{}' },
  ]);
  assert.equal(merged.entries.meal.local.payload.kcal, 100);
  assert.equal(merged.entries.meal.remote.payload.kcal, 200);
  assert.equal(merged.entries.meal.broken, undefined);
});

test('журналы из двух вкладок объединяют независимые записи и outbox', () => {
  const current = {
    token: null,
    settings: { aiConsent: false },
    entries: { meal: {
      local: { kind: 'meal', clientId: 'local', at: '2026-07-22T10:00:00Z', payload: { kcal: 100 } },
    } },
    outbox: [{ kind: 'meal', clientId: 'local' }],
  };
  const fromOtherTab = {
    token: 'backup-token',
    settings: { aiConsent: true },
    entries: {
      meal: {
        local: { kind: 'meal', clientId: 'local', at: '2026-07-22T10:00:00Z', payload: { kcal: 999 } },
      },
      practice: {
        remote: { kind: 'practice', clientId: 'remote', at: '2026-07-22T11:00:00Z', payload: {} },
      },
    },
    outbox: [{ kind: 'practice', clientId: 'remote' }],
  };

  const merged = mergeLocalJournal(current, fromOtherTab);

  assert.equal(merged.entries.meal.local.payload.kcal, 100, 'текущая редакция не затирается');
  assert.ok(merged.entries.practice.remote, 'независимая запись второй вкладки сохранена');
  assert.equal(merged.token, 'backup-token');
  assert.deepEqual(merged.outbox, [
    { kind: 'practice', clientId: 'remote' },
    { kind: 'meal', clientId: 'local' },
  ]);
});

test('конфликт одной записи между вкладками разрешается по updatedAt', () => {
  const current = {
    entries: { meal: {
      same: {
        kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
        updatedAt: '2026-07-22T10:01:00Z', payload: { kcal: 100 },
      },
    } },
    outbox: [], settings: {}, token: null,
  };
  const remote = {
    entries: { meal: {
      same: {
        kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
        updatedAt: '2026-07-22T10:02:00Z', payload: { kcal: 200 },
      },
    } },
    outbox: [], settings: {}, token: null,
  };

  assert.equal(mergeLocalJournal(current, remote).entries.meal.same.payload.kcal, 200);
});

test('конфликт с сервером заменяет локальную устаревшую запись и снимает её с outbox', () => {
  const journal = {
    entries: { meal: {
      same: {
        kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
        updatedAt: '2026-07-22T10:01:00Z', payload: { kcal: 100 },
      },
    } },
    outbox: [{ kind: 'meal', clientId: 'same' }],
  };
  const result = applySyncConflicts(journal, [{
    kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
    updatedAt: '2026-07-22T10:02:00Z', payload: '{"kcal":200}',
  }]);

  assert.equal(result.entries.meal.same.payload.kcal, 200);
  assert.deepEqual(result.outbox, []);
});

test('каноническая запись сервера побеждает даже при равной ревизии', () => {
  const journal = {
    entries: { meal: {
      same: {
        kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
        updatedAt: '2026-07-22T10:02:00Z', payload: { kcal: 100 },
      },
    } },
    outbox: [{ kind: 'meal', clientId: 'same' }],
  };
  const result = applySyncConflicts(journal, [{
    kind: 'meal', clientId: 'same', at: '2026-07-22T10:00:00Z',
    updatedAt: '2026-07-22T10:02:00Z', payload: '{"kcal":200}',
  }]);

  assert.equal(result.entries.meal.same.payload.kcal, 200);
  assert.deepEqual(result.outbox, []);
});
