// Контроллер приложения: журнал, петля синхронизации, навигация.
// Расчёты — в domain, сеть и хранилище — в infrastructure.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mergeLocalJournal, mergeSnapshot, synchronizeJournal } from '../application/sync/journalSync.js';
import {
  BACKUP_CONSENT_VERSION, registerDevice, restoreDeviceJournal,
} from '../application/sync/deviceJournal.js';
import { api } from '../infrastructure/api.js';
import {
  corruptJournalBackup, exportJson, freshJournalAfterRecovery, JOURNAL_STORAGE_KEY, listOf, loadJournal,
  newClientId, saveJournal, stageServerDeletion, upsertEntry, wipeJournal,
} from '../infrastructure/storage.js';
import { TabBar } from './components.jsx';
import Runner from './Runner.jsx';
import Accord from './tabs/Accord.jsx';
import Dynamics from './tabs/Dynamics.jsx';
import More from './tabs/More.jsx';
import Nutrition from './tabs/Nutrition.jsx';
import Practice from './tabs/Practice.jsx';
import Today from './tabs/Today.jsx';
import AdminPanel from './AdminPanel.jsx';
import {
  applyTheme, loadThemePreference, resolveTheme, saveThemePreference,
} from '../infrastructure/theme.js';

const TABS = [
  { id: 'today', name: 'Сегодня', icon: 'today' },
  { id: 'nutrition', name: 'Тело', icon: 'body' },
  { id: 'practice', name: 'Практика', icon: 'practice' },
  { id: 'accord', name: 'Аккорд', icon: 'accord' },
  { id: 'dynamics', name: 'Динамика', icon: 'dynamics' },
  { id: 'more', name: 'Ещё', icon: 'more' },
];

export default function App() {
  const [journal, setJournal] = useState(loadJournal);
  const [tab, setTab] = useState('today');
  const [running, setRunning] = useState(null); // практика в исполнении
  const [syncState, setSyncState] = useState(
    journal.token && journal.settings?.backupConsentVersion === BACKUP_CONSENT_VERSION
      ? 'pending'
      : null
  );
  const [storageState, setStorageState] = useState('ok');
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const syncing = useRef(false);
  const retryTimer = useRef(null);
  const retryAttempt = useRef(0);
  const journalRef = useRef(journal);
  journalRef.current = journal;

  useEffect(() => {
    // Вкладки — отдельные экраны. Не переносим позицию прокрутки с предыдущего
    // экрана, иначе новая вкладка может открыться с середины текста.
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    applyTheme(themePreference);
    if (themePreference !== 'system' || typeof matchMedia !== 'function') return undefined;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme('system');
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [themePreference]);

  const toggleTheme = () => {
    const next = resolveTheme(themePreference) === 'dark' ? 'light' : 'dark';
    saveThemePreference(next);
    setThemePreference(next);
  };

  // Админ-маршрут: рендерим только панель при прямом заходе на /admin.
  const isAdmin = typeof window !== 'undefined'
    && /\/admin$/.test(window.location.pathname.replace(/\/+$/, ''));

  // Захват реферального промокода из URL (?ref=CODE).
  const [refCode, setRefCode] = useState(() => {
    try { return localStorage.getItem('nota_ref'); } catch { return null; }
  });
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) { localStorage.setItem('nota_ref', ref); setRefCode(ref); }
    } catch {}
  }, []);

  useEffect(() => {
    setStorageState(saveJournal(journal) ? 'ok' : 'error');
  }, [journal]);

  // Вторая вкладка может сохранить журнал между рендерами текущей. Вместо
  // полной замены объединяем независимые записи и их outbox-маркеры.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== JOURNAL_STORAGE_KEY || !event.newValue) return;
      try {
        const remote = JSON.parse(event.newValue);
        setJournal((prev) => {
          // Удаление — необратимое намерение пользователя и должно победить
          // обычное объединение вкладок, иначе старая вкладка вернёт записи.
          if (remote.settings?.pendingServerDeletion) {
            return stageServerDeletion(remote.token);
          }
          if (prev.settings?.pendingServerDeletion) return { ...prev };
          const merged = mergeLocalJournal(prev, remote);
          return JSON.stringify(merged) === JSON.stringify(prev) ? prev : merged;
        });
      } catch { /* повреждённое внешнее значение обработает следующий запуск */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const lists = useMemo(() => ({
    state: listOf(journal, 'state'),
    practice: listOf(journal, 'practice'),
    meal: listOf(journal, 'meal'),
    will: listOf(journal, 'will'),
    activity: listOf(journal, 'activity'),
    profile: listOf(journal, 'profile'),
    ritual: listOf(journal, 'ritual'),
    body: listOf(journal, 'body'),
  }), [journal]);

  // Отправка outbox: повторяемая, идемпотентная (client_id), молчаливая при офлайне.
  const syncNow = useCallback(async () => {
    const j = journalRef.current;
    if (!j.token
      || j.settings?.backupConsentVersion !== BACKUP_CONSENT_VERSION
      || j.settings?.pendingServerDeletion
      || syncing.current) return;
    if (j.outbox.length === 0) { setSyncState('ok'); return; }
    syncing.current = true;
    setSyncState('pending');
    try {
      const sync = await synchronizeJournal(j, (entries) => api.sync(j.token, entries));
      setJournal(sync.apply);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      retryAttempt.current = 0;
      setSyncState(sync.result.rejected?.length ? 'error' : 'ok');
    } catch {
      setSyncState('offline'); // данные локально целы; попробуем позже
      if (!retryTimer.current) {
        const delay = Math.min(60_000, 5_000 * (2 ** retryAttempt.current));
        retryAttempt.current += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          syncNow();
        }, delay);
      }
    } finally {
      syncing.current = false;
    }
  }, []);

  useEffect(() => {
    const resume = () => {
      retryAttempt.current = 0;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      syncNow();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') resume(); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [syncNow]);

  useEffect(() => {
    if (!journal.token) return undefined;
    const t = setTimeout(syncNow, 2500);
    return () => clearTimeout(t);
  }, [
    journal.outbox.length,
    journal.token,
    journal.settings?.backupConsentVersion,
    syncNow,
  ]);

  const addEntry = useCallback((kind, payload, at, clientId) => {
    setJournal((prev) => upsertEntry(prev, kind, payload, at, clientId).journal);
  }, []);

  const updateEntry = useCallback((kind, clientId, payload, at) => {
    setJournal((prev) => {
      const existing = prev.entries[kind]?.[clientId];
      return upsertEntry(prev, kind, payload, at || existing?.at, clientId).journal;
    });
  }, []);

  const enableSync = useCallback(async () => {
    const registration = await registerDevice(api.register, BACKUP_CONSENT_VERSION);
    setJournal(registration.apply);
  }, []);

  // Восстановление на новом/очищенном устройстве: скачиваем snapshot по токену
  // и подмешиваем записи, которых нет локально. Локальные записи главнее —
  // восстановление ничего не затирает; сервер уже знает эти client_id,
  // поэтому в outbox они не ставятся.
  const restoreWithToken = useCallback(async (token) => {
    await api.setDataConsent(token, true, BACKUP_CONSENT_VERSION);
    const restored = await restoreDeviceJournal(token, api.snapshot);
    setJournal((journalBeforeRestore) => {
      const restoredJournal = restored.apply(journalBeforeRestore);
      return {
        ...restoredJournal,
        settings: {
          ...restoredJournal.settings,
          backupConsent: true,
          backupConsentVersion: BACKUP_CONSENT_VERSION,
          backupConsentAt: new Date().toISOString(),
        },
      };
    });
    setSyncState('ok');
  }, []);

  const setSettings = useCallback((settings) => {
    setJournal((prev) => ({ ...prev, settings }));
  }, []);

  const wipeAll = useCallback(() => {
    setJournal(wipeJournal());
    setSyncState(null);
  }, []);

  const downloadCorruptBackup = useCallback(() => {
    const raw = corruptJournalBackup();
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `svoya-nota-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  const downloadUnsavedJournal = useCallback(() => {
    const blob = new Blob([exportJson(journalRef.current)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `svoya-nota-unsaved-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  const startFreshJournal = useCallback(() => {
    if (confirm('Начать новый журнал? Повреждённая копия останется доступна для скачивания до полного удаления данных.')) {
      setJournal(freshJournalAfterRecovery());
    }
  }, []);

  const stageDeletion = useCallback((token) => {
    setJournal(stageServerDeletion(token));
    setSyncState(null);
  }, []);

  // Удаление уже подтверждено пользователем. Повторяем его при запуске и
  // возвращении сети, не синхронизируя при этом никаких пользовательских данных.
  useEffect(() => {
    if (!journal.settings?.pendingServerDeletion || !journal.token) return undefined;
    let disposed = false;
    let deleting = false;
    const retryDeletion = async () => {
      if (disposed || deleting) return;
      deleting = true;
      try {
        await api.deleteMe(journal.token);
        if (!disposed) {
          setJournal(wipeJournal());
          setSyncState(null);
        }
      } catch { /* сеть недоступна: повторится при следующем запуске/online */ }
      finally { deleting = false; }
    };
    void retryDeletion();
    window.addEventListener('online', retryDeletion);
    return () => {
      disposed = true;
      window.removeEventListener('online', retryDeletion);
    };
  }, [journal.settings?.pendingServerDeletion, journal.token]);

  const openPractice = useCallback((p) => setRunning(p), []);

  const common = {
    journal, lists, addEntry, updateEntry, openPractice,
    goTo: setTab,
    token: journal.token,
    settings: journal.settings,
    aiConsent: journal.settings.aiConsent,
  };

  if (isAdmin) return <AdminPanel />;

  return (
    <div className="wrap">
      <header className="app">
        <div className="brand">
          <h1>Своя нота</h1>
          <div className="brand-tools">
            <span className="meta">{new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
            <button type="button" className="theme-toggle" onClick={toggleTheme}
              aria-label={resolveTheme(themePreference) === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              title={resolveTheme(themePreference) === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
              {resolveTheme(themePreference) === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      {journal.recovery?.corrupted && (
        <p className="storage-warning" role="alert">
          Журнал в браузере повреждён. Исходная копия сохранена отдельно и не будет перезаписана.
          <button type="button" className="btn ghost" onClick={downloadCorruptBackup}>Скачать копию</button>
          <button type="button" className="btn warn" onClick={startFreshJournal}>Начать новый журнал</button>
        </p>
      )}

      {storageState === 'error' && !journal.recovery?.corrupted && (
        <p className="storage-warning" role="status">
          Браузер не сохранил изменения. Не закрывайте страницу: проверьте свободное место и разрешение на хранение данных.
          <button type="button" className="btn ghost" onClick={downloadUnsavedJournal}>
            Скачать несохранённые данные
          </button>
        </p>
      )}

      {refCode && (
        <p className="ref-note" role="status">
          Промокод реферала «{refCode}» сохранён — скидка по ссылке учтётся при оформлении.
          <button type="button" className="ref-note-x" aria-label="скрыть"
            onClick={() => { try { localStorage.removeItem('nota_ref'); } catch {} setRefCode(null); }}>×</button>
        </p>
      )}

      {tab === 'today' && <Today {...common} />}
      {tab === 'nutrition' && <Nutrition {...common} />}
      {tab === 'practice' && <Practice {...common} />}
      {tab === 'accord' && <Accord {...common} />}
      {tab === 'dynamics' && <Dynamics {...common} />}
      {tab === 'more' && (
        <More {...common} setSettings={setSettings} enableSync={enableSync}
          restoreWithToken={restoreWithToken}
          wipeAll={wipeAll} stageDeletion={stageDeletion} syncNow={syncNow} syncState={syncState} />
      )}

      {running && (
        <Runner practice={running}
          onSave={(payload) => { addEntry('practice', payload); setRunning(null); }}
          onClose={() => setRunning(null)} />
      )}

      <TabBar tabs={TABS} active={tab} onSelect={setTab} />
    </div>
  );
}
