import { NUTRITION_FORECAST_KEY } from '../domain/keys.js';
import { digestionNoiseAt } from '../domain/loop.js';

const NUTRITION_WINDOW_MS = 24 * 60 * 60 * 1000;

function readForecast(storage, now) {
  const raw = storage.getItem(NUTRITION_FORECAST_KEY);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (typeof data.startedAt !== 'number' || now - data.startedAt >= NUTRITION_WINDOW_MS) return null;
  return data;
}

export function readMassForecast({ storage = localStorage, now = Date.now() } = {}) {
  try {
    const data = readForecast(storage, now);
    return data && typeof data.kg === 'number' ? data.kg : null;
  } catch {
    return null;
  }
}

export function readTodayNoise({ storage = localStorage, now = Date.now() } = {}) {
  try {
    const data = readForecast(storage, now);
    if (!data) return 0;
    if (Array.isArray(data.digestion)) return digestionNoiseAt(data.digestion, now);
    return typeof data.noise === 'number' ? Math.max(0, Math.min(1, data.noise)) : 0;
  } catch {
    return 0;
  }
}
