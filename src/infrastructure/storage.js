// Локальное хранилище журнала (localStorage) + outbox синхронизации.
// Приложение полностью работает без сервера; сервер — резервная копия.

import {
  JOURNAL_KEY, BODY_KEY, NUTRITION_FORECAST_KEY, PHONE_STEPS_KEY, WEIGHT_KEY,
  NUTRITION_WIDGET_KEY, PREFS_KEY, REFERRAL_KEY, LEGACY_KEYS,
} from '../domain/keys.js';

const KEY = JOURNAL_KEY;
export const JOURNAL_STORAGE_KEY = KEY;
let lastRevisionMs = 0;

function nextRevision(previousRevision) {
  // Date.now() может повториться при двух нажатиях в один тик или при откате
  // системных часов. Предыдущая ревизия учитывается и после перезагрузки.
  const previousMs = Date.parse(previousRevision || '');
  lastRevisionMs = Math.max(
    Date.now(),
    lastRevisionMs + 1,
    Number.isNaN(previousMs) ? 0 : previousMs + 1,
  );
  return new Date(lastRevisionMs).toISOString();
}
const CORRUPT_JOURNAL_KEY = `${JOURNAL_KEY}.corrupt`;
const KINDS = ['state', 'practice', 'meal', 'will', 'activity', 'profile', 'ritual'];
const APP_LOCAL_KEYS = [
  JOURNAL_KEY,
  CORRUPT_JOURNAL_KEY,
  BODY_KEY,
  WEIGHT_KEY,
  PHONE_STEPS_KEY,
  NUTRITION_WIDGET_KEY,
  NUTRITION_FORECAST_KEY,
  PREFS_KEY,
  REFERRAL_KEY,
  ...LEGACY_KEYS,
];

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const empty = () => ({
  token: null,
  settings: { aiConsent: false },
  entries: Object.fromEntries(KINDS.map((k) => [k, {}])),
  outbox: [],
});

function normalizeJournal(data) {
  if (!isRecord(data)) throw new TypeError('journal must be an object');
  const base = empty();
  const rawEntries = isRecord(data.entries) ? data.entries : {};
  const entries = { ...base.entries };
  for (const kind of KINDS) {
    const source = rawEntries[kind];
    if (!isRecord(source)) continue;
    entries[kind] = Object.fromEntries(Object.entries(source).flatMap(([clientId, entry]) => {
      if (
        typeof clientId !== 'string'
        || !isRecord(entry)
        || entry.kind !== kind
        || entry.clientId !== clientId
        || typeof entry.at !== 'string'
        || entry.at.length < 4
        || entry.at.length > 40
        || !isRecord(entry.payload)
      ) return [];
      // Старый журнал без updatedAt остаётся совместимым. Повреждённую
      // ревизию отбрасываем: sync безопасно использует время события `at`.
      const { updatedAt: rawUpdatedAt, ...safeEntry } = entry;
      const updatedAt = typeof rawUpdatedAt === 'string' ? rawUpdatedAt : null;
      return [[clientId, {
        ...safeEntry,
        ...(updatedAt && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(updatedAt) ? { updatedAt } : {}),
      }]];
    }));
  }
  const seenOutbox = new Set();
  const outbox = Array.isArray(data.outbox)
    ? data.outbox.filter((item) => {
      if (
        !isRecord(item)
        || !KINDS.includes(item.kind)
        || typeof item.clientId !== 'string'
        || !entries[item.kind][item.clientId]
      ) return false;
      const key = `${item.kind}:${item.clientId}`;
      if (seenOutbox.has(key)) return false;
      seenOutbox.add(key);
      return true;
    })
    : [];
  return {
    ...base,
    token: typeof data.token === 'string' ? data.token : null,
    settings: { ...base.settings, ...(isRecord(data.settings) ? data.settings : {}) },
    entries,
    outbox,
  };
}

export function loadJournal() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return normalizeJournal(JSON.parse(raw));
  } catch {
    // Не затираем потенциально восстанавливаемые данные пустым журналом.
    // Первую повреждённую копию сохраняем отдельно до явного решения пользователя.
    try {
      if (raw && !localStorage.getItem(CORRUPT_JOURNAL_KEY)) {
        localStorage.setItem(CORRUPT_JOURNAL_KEY, raw);
      }
    } catch { /* приватный режим или квота: UI всё равно не падает */ }
    return { ...empty(), recovery: { corrupted: true } };
  }
}

export function saveJournal(journal) {
  if (journal?.recovery?.corrupted) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(journal));
    return true;
  } catch {
    return false; // квота/приватный режим — работаем в памяти
  }
}

export function corruptJournalBackup() {
  try { return localStorage.getItem(CORRUPT_JOURNAL_KEY); } catch { return null; }
}

export function freshJournalAfterRecovery() {
  // Резервная копия остаётся доступной до «Удалить все данные».
  return empty();
}

export function newClientId(uuid = () => globalThis.crypto?.randomUUID?.()) {
  // Web Crypto отсутствует в части webview и старых браузеров. Идентификатор
  // нужен для локальной идемпотентности, поэтому деградируем без падения UI.
  let value;
  try { value = uuid(); } catch { /* перейдём к безопасному локальному fallback */ }
  return (typeof value === 'string' && value ? value : `${Date.now()}-${Math.random()}`).slice(0, 36);
}

// Плоский список записей вида для расчётов петли: {clientId, at, payload}.
export function listOf(journal, kind) {
  return Object.values(journal.entries[kind] || {});
}

export function upsertEntry(journal, kind, payload, at = new Date().toISOString(), clientId = newClientId()) {
  // `updatedAt` — локальная ревизия записи. Она не меняет время события `at`,
  // но позволяет безопасно разрешать конфликт одинакового clientId во вкладках.
  const previous = journal.entries[kind]?.[clientId];
  const entry = { clientId, kind, at, payload, updatedAt: nextRevision(previous?.updatedAt) };
  const next = {
    ...journal,
    entries: { ...journal.entries, [kind]: { ...journal.entries[kind], [clientId]: entry } },
    outbox: [...journal.outbox.filter((o) => !(o.kind === kind && o.clientId === clientId)), { kind, clientId }],
  };
  return { journal: next, entry };
}

function removeAppLocalData({ keepJournal = false } = {}) {
  try {
    APP_LOCAL_KEYS.filter((key) => !keepJournal || key !== JOURNAL_KEY)
      .forEach((key) => localStorage.removeItem(key));
  } catch { /* приватный режим или уже очищено */ }
}

export function wipeJournal() {
  removeAppLocalData();
  return empty();
}

// Если сервер временно недоступен, оставляем только токен удаления и никаких
// пользовательских записей. Это позволяет повторить DELETE без риска вернуть
// удалённые данные в синхронизацию.
export function stageServerDeletion(token) {
  removeAppLocalData({ keepJournal: true });
  return {
    ...empty(),
    token,
    settings: { aiConsent: false, pendingServerDeletion: true },
  };
}

export function exportJson(journal) {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), entries: journal.entries },
    null, 2
  );
}
