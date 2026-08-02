const DEFAULT_BATCH_SIZE = 150;

function entryFingerprint(entry) {
  return JSON.stringify({ at: entry.at, updatedAt: entry.updatedAt, payload: entry.payload });
}

function entryRevision(entry) {
  const candidate = entry?.updatedAt || entry?.at || '';
  // Старые снимки могли содержать произвольное `at`; такие значения нельзя
  // сравнивать лексикографически с ISO-временем и объявлять новее записи.
  return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(candidate) ? candidate : '';
}

function latestEntry(local, remote) {
  // При равных ревизиях текущая вкладка остаётся детерминированным победителем.
  return entryRevision(remote) > entryRevision(local) ? remote : local;
}

export function createSyncBatch(journal, limit = DEFAULT_BATCH_SIZE) {
  const batch = journal.outbox.slice(0, Math.max(1, limit)).map(({ kind, clientId }) => {
    const entry = journal.entries[kind]?.[clientId];
    return { kind, clientId, fingerprint: entry ? entryFingerprint(entry) : null };
  });
  const entries = batch
    .map(({ kind, clientId, fingerprint }) => ({
      entry: journal.entries[kind]?.[clientId], kind, clientId, fingerprint,
    }))
    .filter(({ entry, fingerprint }) => entry && fingerprint)
    .map(({ entry }) => ({
      kind: entry.kind,
      clientId: entry.clientId,
      at: entry.at,
      updatedAt: entry.updatedAt || entry.at,
      payload: JSON.stringify(entry.payload),
    }));
  return { batch, entries };
}

// Порт sendEntries принимает сериализованные записи и возвращает ответ сервера.
// Сценарий не знает ни HTTP, ни токенов, ни React; адаптер передаётся снаружи.
export async function synchronizeJournal(journal, sendEntries) {
  const { batch, entries } = createSyncBatch(journal);
  const result = entries.length
    ? await sendEntries(entries)
    : { accepted: [], rejected: [], conflicts: [] };
  // Старый сервер во время rolling deploy мог возвращать число accepted.
  const accepted = Array.isArray(result.accepted)
    ? result.accepted
    : batch
      .filter(({ fingerprint, clientId }) => fingerprint && !result.rejected?.includes(clientId))
      .map(({ kind, clientId }) => ({ kind, clientId }));

  return {
    result,
    apply(currentJournal) {
      return applySyncConflicts(
        acknowledgeSyncBatch(currentJournal, batch, accepted),
        result.conflicts || [],
      );
    },
  };
}

export function acknowledgeSyncBatch(journal, batch, accepted = []) {
  const acceptedKeys = new Set(accepted.map(({ kind, clientId }) => `${kind}:${clientId}`));
  const sent = new Map(batch.map((item) => [`${item.kind}:${item.clientId}`, item]));
  return {
    ...journal,
    outbox: journal.outbox.filter(({ kind, clientId }) => {
      const item = sent.get(`${kind}:${clientId}`);
      if (!item) return true;
      // Stale queue markers have no entry to send and can be cleaned up safely.
      if (!item.fingerprint) return false;
      if (!acceptedKeys.has(`${kind}:${clientId}`)) return true;
      const current = journal.entries[kind]?.[clientId];
      // Keep a mutation made while the request was in flight in the outbox.
      return !current || entryFingerprint(current) !== item.fingerprint;
    }),
  };
}

export function mergeSnapshot(journal, remoteEntries, { force = false } = {}) {
  const nextEntries = { ...journal.entries };
  for (const entry of remoteEntries || []) {
    const localKind = nextEntries[entry?.kind];
    if (!localKind || !entry.clientId) continue;
    let payload;
    try { payload = JSON.parse(entry.payload); } catch { continue; }
    const remote = {
      clientId: entry.clientId,
      kind: entry.kind,
      at: entry.at,
      payload,
      updatedAt: entry.updatedAt || entry.at,
    };
    const local = localKind[entry.clientId];
    if (!local || force || entryRevision(remote) > entryRevision(local)) {
      nextEntries[entry.kind] = { ...localKind, [entry.clientId]: remote };
    }
  }
  return { ...journal, entries: nextEntries };
}

export function applySyncConflicts(journal, conflicts) {
  // Конфликт возвращает каноническую строку из БД. Она должна заменить
  // локальную даже при равной ревизии: это защита от редкой коллизии ревизий.
  const merged = mergeSnapshot(journal, conflicts, { force: true });
  const keys = new Set((conflicts || []).map(({ kind, clientId }) => `${kind}:${clientId}`));
  return {
    ...merged,
    outbox: merged.outbox.filter(({ kind, clientId }) => !keys.has(`${kind}:${clientId}`)),
  };
}


// localStorage не даёт транзакций между вкладками. При внешнем изменении
// объединяем независимые записи и очередь, оставляя текущей вкладке право на
// конфликтующую редакцию той же записи. Это исключает потерю всего журнала
// из-за обычного last-writer-wins перезаписывания документа.
export function mergeLocalJournal(journal, other) {
  const kinds = new Set([
    ...Object.keys(journal.entries || {}),
    ...Object.keys(other?.entries || {}),
  ]);
  const entries = {};
  for (const kind of kinds) {
    const remoteKind = other?.entries?.[kind] || {};
    const localKind = journal.entries?.[kind] || {};
    entries[kind] = { ...remoteKind };
    for (const [clientId, localEntry] of Object.entries(localKind)) {
      entries[kind][clientId] = latestEntry(localEntry, remoteKind[clientId]);
    }
  }
  const seenOutbox = new Set();
  const outbox = [...(other?.outbox || []), ...(journal.outbox || [])]
    .filter(({ kind, clientId }) => {
      const key = `${kind}:${clientId}`;
      if (seenOutbox.has(key)) return false;
      seenOutbox.add(key);
      return true;
    });
  return {
    ...other,
    ...journal,
    token: journal.token || other?.token || null,
    settings: { ...(other?.settings || {}), ...(journal.settings || {}) },
    entries,
    outbox,
  };
}
