// Device-only порт шагов. В обычном браузере HealthKit/Health Connect закрыты;
// нативная оболочка может предоставить минимальный мост readDailySteps(date).
import { PHONE_STEPS_KEY } from '../domain/keys.js';

const validSteps = (value) => {
  const steps = Math.round(Number(value));
  return Number.isFinite(steps) && steps >= 0 && steps < 200_000 ? steps : null;
};

export function loadPhoneSteps(date) {
  try {
    const data = JSON.parse(localStorage.getItem(PHONE_STEPS_KEY) || '{}');
    const record = data?.days?.[date];
    const steps = validSteps(record?.steps);
    return steps === null ? null : { ...record, date, steps };
  } catch {
    return null;
  }
}

export function loadPhoneStepsMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(PHONE_STEPS_KEY) || '{}');
    const days = raw?.days;
    if (!days || typeof days !== 'object' || Array.isArray(days)) return {};
    return Object.fromEntries(Object.entries(days).filter(([, value]) => Number(value?.steps) > 0));
  } catch {
    return {};
  }
}

export function hasPhoneStepsBridge(host = globalThis.window) {
  const bridge = host?.SvoyaNotaHealth || host?.AndroidHealthConnect;
  return typeof (bridge?.readDailySteps || bridge?.readTodaySteps) === 'function';
}

export function savePhoneSteps(date, steps, source = 'phone') {
  const value = validSteps(steps);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value === null) return null;
  const record = {
    date,
    steps: value,
    source: String(source || 'phone').slice(0, 60),
    updatedAt: new Date().toISOString(),
  };
  try {
    const previous = JSON.parse(localStorage.getItem(PHONE_STEPS_KEY) || '{}');
    const days = { ...(previous?.days || {}), [date]: record };
    const keys = Object.keys(days).sort().slice(-90);
    localStorage.setItem(PHONE_STEPS_KEY, JSON.stringify({
      days: Object.fromEntries(keys.map((key) => [key, days[key]])),
    }));
  } catch {
    return null;
  }
  return record;
}

export async function readPhoneSteps(date, host = globalThis.window) {
  const bridge = host?.SvoyaNotaHealth || host?.AndroidHealthConnect;
  const reader = bridge?.readDailySteps || bridge?.readTodaySteps;
  if (typeof reader !== 'function') {
    return { supported: false, reason: 'native_bridge_required' };
  }
  try {
    const raw = await reader.call(bridge, date);
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const steps = validSteps(payload?.steps ?? payload);
    if (steps === null) return { supported: true, error: 'invalid_data' };
    return {
      supported: true,
      steps,
      source: payload?.source || 'Health Connect',
    };
  } catch {
    return { supported: true, error: 'permission_or_read_failed' };
  }
}
