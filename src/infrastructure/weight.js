// Вес — самонаблюдение, хранится ТОЛЬКО на устройстве: не является записью
// журнала (kind), не попадает в sync-outbox и не уходит на сервер.
// При этом ключ входит в APP_LOCAL_KEYS, поэтому «Удалить все данные» стирает
// и отметки веса — иначе они остались бы на устройстве без способа их убрать.
// Справочное наблюдение, не медицинская рекомендация.
import { WEIGHT_KEY } from '../domain/keys.js';

export function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHT_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v?.entries) ? v.entries : [];
  } catch {
    return [];
  }
}

export function latestWeightKg() {
  const entries = loadWeights();
  if (!entries.length) return null;
  const kg = Number(entries[entries.length - 1].kg);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

export function addWeight(kg, at = new Date().toISOString()) {
  const kgNum = Math.round(Number(kg) * 10) / 10;
  if (!Number.isFinite(kgNum) || kgNum <= 0) return loadWeights();
  const entries = loadWeights().filter((entry) => dayOf(entry.at) !== dayOf(at));
  entries.push({ at, kg: kgNum, source: 'self-report' });
  entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const capped = entries.slice(-180);
  try { localStorage.setItem(WEIGHT_KEY, JSON.stringify({ entries: capped })); } catch { /* private mode */ }
  return capped;
}

export function removeWeightEntry(at) {
  const entries = loadWeights().filter((e) => e.at !== at);
  try { localStorage.setItem(WEIGHT_KEY, JSON.stringify({ entries })); } catch { /* private mode */ }
  return entries;
}

export function clearWeights() {
  try { localStorage.removeItem(WEIGHT_KEY); } catch { /* уже очищено */ }
  return [];
}
