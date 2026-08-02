// «Ещё»: синхронизация, согласие на ИИ, импорт трекера, экспорт и удаление данных,
// о методе и границах приложения.
import React, { useState } from 'react';
import { api } from '../../infrastructure/api.js';
import { BACKUP_CONSENT_VERSION } from '../../application/sync/deviceJournal.js';
import { exportJson } from '../../infrastructure/storage.js';
import { Card } from '../components.jsx';
import BodyObservations from '../BodyObservations.jsx';
import ProfileCard from '../ProfileCard.jsx';

export default function More({
  journal, lists, settings, setSettings, token, enableSync, restoreWithToken, addEntry, wipeAll, stageDeletion, syncNow, syncState,
}) {
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [restoreToken, setRestoreToken] = useState('');
  const [restoreMsg, setRestoreMsg] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const AI_CONSENT_VERSION = '2026-07-22-ai-v1';
  const backupConsent = settings.backupConsentVersion === BACKUP_CONSENT_VERSION;

  const changeBackupConsent = async (granted) => {
    const next = {
      ...settings,
      backupConsent: granted,
      backupConsentAt: granted ? new Date().toISOString() : null,
      backupConsentVersion: granted ? BACKUP_CONSENT_VERSION : null,
      ...(!granted ? { aiConsent: false, aiConsentAt: null, aiConsentVersion: null } : {}),
    };
    setDeleteMsg(null);
    if (!token) {
      setSettings(next);
      return;
    }
    try {
      await api.setDataConsent(token, granted, BACKUP_CONSENT_VERSION);
      if (!granted && settings.aiConsent) {
        await api.setAiConsent(token, false, AI_CONSENT_VERSION).catch(() => {});
      }
      setSettings(next);
      if (!granted) setDeleteMsg('Синхронизация остановлена. Уже сохранённую копию можно удалить кнопкой ниже.');
    } catch {
      setDeleteMsg(granted
        ? 'Не удалось зафиксировать согласие на сервере. Синхронизация остаётся выключенной.'
        : 'Синхронизация остановлена на устройстве. Сервер недоступен; удалите копию после восстановления связи.');
      if (!granted) setSettings(next);
    }
  };

  const changeAiConsent = async (granted) => {
    const next = {
      ...settings,
      aiConsent: granted,
      aiConsentAt: granted ? new Date().toISOString() : null,
      aiConsentVersion: granted ? AI_CONSENT_VERSION : null,
    };
    // Revocation takes effect locally immediately. A failed network request never
    // leaves the client able to submit another AI request.
    if (!granted) setSettings(next);
    if (!token) {
      if (granted) setDeleteMsg('Для AI сначала включите резервную копию: она создаёт защищённый токен устройства.');
      return;
    }
    try {
      await api.setAiConsent(token, granted, AI_CONSENT_VERSION);
      if (granted) setSettings(next);
    } catch {
      setDeleteMsg(granted
        ? 'Не удалось сохранить согласие на сервере. AI остаётся выключенным.'
        : 'Согласие отключено на устройстве. Сервер недоступен — повторите отключение позже.');
    }
  };

  const doRestore = async (tok) => {
    setBusy(true);
    setRestoreMsg(null);
    try {
      await restoreWithToken(tok.trim());
      setRestoreMsg('Данные восстановлены с сервера.');
      setRestoreToken('');
    } catch (e) {
      setRestoreMsg(e?.code === 'unauthorized'
        ? 'Токен не подошёл. Проверьте, что он скопирован целиком.'
        : 'Нет связи с сервером. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([exportJson(journal)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `svoya-nota-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const deleteAllData = async () => {
    if (!confirm('Удалить все данные на устройстве' + (token ? ' и на сервере' : '') + '? Это необратимо.')) return;
    setBusy(true);
    setDeleteMsg(null);
    try {
      if (token) await api.deleteMe(token);
      wipeAll();
    } catch {
      // Локальные данные всё равно должны быть удалены. Токен остаётся только
      // для безопасного автоматического/ручного повтора DELETE /api/me.
      stageDeletion(token);
      setDeleteMsg('Локальные данные удалены. Сервер сейчас недоступен: удаление серверной копии ожидает повтора.');
    } finally {
      setBusy(false);
    }
  };

  if (settings.pendingServerDeletion) {
    return (
      <Card eyebrow="Удаление данных">
        <p className="small dim">
          Данные на этом устройстве уже удалены. Сохранён только технический токен,
          чтобы удалить серверную копию; повтор выполняется автоматически при запуске
          и появлении сети. Токен не используется для синхронизации или ИИ.
        </p>
        <button className="btn warn" disabled={busy || !token} onClick={async () => {
          setBusy(true);
          try { await api.deleteMe(token); wipeAll(); }
          catch { setDeleteMsg('Сервер пока недоступен. Повторите удаление позже.'); }
          finally { setBusy(false); }
        }}>
          Повторить удаление серверной копии
        </button>
        {deleteMsg && <p className="small">{deleteMsg}</p>}
      </Card>
    );
  }

  return (
    <>
      <Card eyebrow="Данные и связь">
        <p className="small dim">
          Всё хранится на этом устройстве и работает без сети. Сервер — только
          резервная копия и ИИ-оценка КБЖУ, если вы их включите.
        </p>
        <label className="fl consent-box">
          <input type="checkbox" checked={backupConsent}
            onChange={(event) => { void changeBackupConsent(event.target.checked); }} />
          <span>
            Разрешаю обработку записей дневника на сервере в РФ для резервного
            копирования и восстановления. В копию могут входить сведения о
            самочувствии, питании, сне, активности и практиках.
          </span>
        </label>
        <p className="tiny dim">
          Функция добровольная; без неё журнал остаётся на устройстве. Согласие
          оформляется отдельно от соглашения и фиксируется с версией и временем.
          Подробнее — в <a href="privacy.html" target="_blank" rel="noreferrer">политике обработки данных</a>.
        </p>
        {!token ? (
          <>
            <button className="btn" onClick={async () => {
              setBusy(true);
              try { await enableSync(); } finally { setBusy(false); }
            }} disabled={busy || !backupConsent}>
              Включить резервную копию
            </button>
            <div style={{ marginTop: 12 }}>
              <label className="fl" htmlFor="restore-token">Перенос с другого устройства</label>
              <input id="restore-token" type="text" value={restoreToken}
                placeholder="Вставьте токен резервной копии"
                onChange={(e) => setRestoreToken(e.target.value)} />
              <button className="btn ghost" disabled={busy || !restoreToken.trim() || !backupConsent}
                onClick={() => doRestore(restoreToken)}>
                Восстановить данные
              </button>
              {restoreMsg && <p className="small">{restoreMsg}</p>}
            </div>
          </>
        ) : (
          <>
            <p className="small">
              {backupConsent ? 'Резервная копия включена. ' : 'Синхронизация остановлена до отдельного согласия. '}
              {syncState === 'ok' && 'Синхронизировано.'}
              {syncState === 'pending' && `В очереди: ${journal.outbox.length}.`}
              {syncState === 'offline' && 'Нет сети — отправится позже.'}
              {syncState === 'error' && 'Часть записей сервер не принял. Они сохранены на устройстве; повторите синхронизацию позже.'}
            </p>
            <button className="btn ghost" disabled={!backupConsent} onClick={syncNow}>
              Синхронизировать сейчас
            </button>
            <div style={{ marginTop: 12 }}>
              <button className="tbtn" onClick={() => setShowToken(!showToken)}>
                {showToken ? 'скрыть токен ▴' : 'токен для переноса на другое устройство ▾'}
              </button>
              {showToken && (
                <>
                  <p className="tiny" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{token}</p>
                  <p className="tiny dim">
                    Сохраните токен: по нему можно восстановить журнал на новом устройстве.
                    Кто знает токен — тот читает копию. На сервере хранится только его хэш.
                  </p>
                  <button className="btn ghost" disabled={busy} onClick={() => doRestore(token)}>
                    Подтянуть данные с сервера на это устройство
                  </button>
                  {restoreMsg && <p className="small">{restoreMsg}</p>}
                </>
              )}
            </div>
          </>
        )}
        <label className="fl" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={settings.aiConsent}
            onChange={(e) => { void changeAiConsent(e.target.checked); }} />
          Разрешаю ИИ-оценку еды: описание или фото блюда передаётся внешнему
          провайдеру модели. На сервере приложения фото не сохраняется. Не загружайте
          лица, документы и другие лишние персональные данные.
        </label>
        <p className="tiny dim">
          ИИ даёт приблизительную оценку, не медицинский вывод. Перед включением
          ознакомьтесь с <a href="privacy.html" target="_blank" rel="noreferrer">политикой обработки данных приложения</a>.
        </p>
        <div className="legal-app-links" aria-label="Документы приложения">
          <span>Тарифы и документы</span>
          <a href="pricing.html" target="_blank" rel="noreferrer">Тарифы и платные услуги</a>
          <a href="license.html" target="_blank" rel="noreferrer">Лицензионное соглашение и возврат</a>
          <a href="privacy.html" target="_blank" rel="noreferrer">Политика конфиденциальности</a>
        </div>
      </Card>

      <ProfileCard lists={lists} addEntry={addEntry} />
      <BodyObservations profile={lists.profile} />

      <Card eyebrow="Ваши данные">
        <button className="btn ghost" onClick={download}>Скачать журнал (JSON)</button>
        <button className="btn warn" disabled={busy} onClick={deleteAllData}>
          Удалить все данные
        </button>
        {deleteMsg && <p className="small">{deleteMsg}</p>}
      </Card>

      <Card eyebrow="О приложении">
        <p className="small dim">
          «Своя нота» соединяет пять частей — питание, тело и чувства, мышление,
          волю и согласованность — в одну недельную петлю: отметка → практика →
          отметка → рефлексия → недельный обзор. Очередность дней построена по
          принципу постепенного восстановления регуляции нервной системы: дыхание,
          тело, голос, мысль, действие, тепло, интеграция. Смысл практик опирается
          на современные исследования внимания, эмоций, влияния убеждений и среды
          на поведение.
        </p>
        <p className="small dim">
          Приложение не является медицинским сервисом, психотерапией или средством
          диагностики. Оценки ИИ приблизительны. При устойчиво тяжёлом состоянии
          обратитесь к специалисту.
        </p>
        <p className="tiny">Версия 1.0 · torion.shop</p>
      </Card>
    </>
  );
}
