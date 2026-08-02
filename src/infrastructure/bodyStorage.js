// Самонаблюдение тела: полностью изолированный device-only контур.
// Никогда не импортирует storage.js/api.js: данные не попадают в журнал,
// экспорт журнала, синхронизацию или резервную копию.
import { BODY_KEY } from '../domain/keys.js';

export const BODY_CONSENT_VERSION = '2026-07-29-body-v2';
const CM_MIN = 30;
const CM_MAX = 300;
const empty = () => ({ v: 1, consent: null, measurements: [] });
function todayISO() { return new Date().toISOString(); }
function dayOf(iso) { return String(iso).slice(0, 10); }
function round1(n) { return Math.round(n * 10) / 10; }

export function loadBody() {
  try {
    const raw = localStorage.getItem(BODY_KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    return {
      ...empty(), ...data,
      consent: data.consent?.grantedAt ? data.consent : null,
      measurements: Array.isArray(data.measurements) ? data.measurements.filter((m) => Number.isFinite(m?.cm) && m?.at) : [],
    };
  } catch { return empty(); }
}
function saveBody(state) {
  try { localStorage.setItem(BODY_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function hasConsent(state) {
  return Boolean(state?.consent?.grantedAt && state?.consent?.version === BODY_CONSENT_VERSION);
}
export function setConsent(state, granted) {
  if (granted) {
    const next = { ...state, consent: { grantedAt: todayISO(), version: BODY_CONSENT_VERSION } };
    saveBody(next); return next;
  }
  try { localStorage.removeItem(BODY_KEY); } catch { /* already removed */ }
  return empty();
}
export function addMeasurement(state, cm, at = todayISO()) {
  const value = round1(Number(String(cm).replace(',', '.')));
  if (!Number.isFinite(value) || value < CM_MIN || value > CM_MAX) return { state, error: 'range' };
  const entry = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, at, cm: value, source: 'self-report' };
  const next = { ...state, measurements: [...state.measurements.filter((m) => dayOf(m.at) !== dayOf(at)), entry] };
  saveBody(next); return { state: next, entry };
}
export function removeMeasurement(state, id) {
  const next = { ...state, measurements: state.measurements.filter((m) => m.id !== id) };
  saveBody(next); return next;
}
export function clearMeasurements(state) {
  const next = { ...state, measurements: [] };
  saveBody(next); return next;
}
export function getSeries(state) { return [...state.measurements].sort((a, b) => a.at.localeCompare(b.at)); }
