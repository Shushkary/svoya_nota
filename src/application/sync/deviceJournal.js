import { mergeSnapshot } from './journalSync.js';

export const BACKUP_CONSENT_VERSION = '2026-07-28-backup-v1';

function queueAllEntries(journal) {
  return Object.entries(journal.entries || {}).flatMap(([kind, records]) =>
    Object.keys(records || {}).map((clientId) => ({ kind, clientId }))
  );
}

// Порт register не раскрывает HTTP-детали use case. apply вызывается над
// актуальным состоянием React, поэтому изменения во время запроса не теряются.
export async function registerDevice(register, consentVersion = BACKUP_CONSENT_VERSION) {
  const { token } = await register(consentVersion);
  if (typeof token !== 'string' || !token) throw new Error('register returned no token');
  return {
    token,
    apply(journal) {
      return {
        ...journal,
        token,
        settings: {
          ...journal.settings,
          backupConsent: true,
          backupConsentVersion: consentVersion,
          backupConsentAt: new Date().toISOString(),
        },
        outbox: queueAllEntries(journal),
      };
    },
  };
}

// Восстановление также возвращает apply, чтобы не перезаписать локальные
// изменения, сделанные пока snapshot был в пути.
export async function restoreDeviceJournal(token, fetchSnapshot) {
  const { entries } = await fetchSnapshot(token);
  return {
    apply(journal) {
      return mergeSnapshot({ ...journal, token }, entries);
    },
  };
}
