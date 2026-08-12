// Петля: журнал → агрегация → параметры тороида и недельный обзор.
// Чистые функции без React, DOM и сети. Все расчёты локальные (офлайн-first).

import { isoDay } from './weekPlan.js';
import { representativeStateByKey, representativeStateValues, polarity } from './stateCheckIn.js';

export const dayKey = (d) => {
  const x = d instanceof Date ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

// Понедельник текущей недели (локальное время устройства).
export function weekStart(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (isoDay(now) - 1));
  return start;
}

export function daysOfWeek(now = new Date()) {
  const start = weekStart(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return dayKey(d);
  });
}

const inKeys = (keys) => (e) => keys.includes(dayKey(e.at));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));
const alive = (e) => !e.payload?.deleted; // мягко удалённые записи не участвуют в расчётах

// Телесные практики питают ту же дугу, что и чувства (грудь).
const ARC_OF = {
  soma: 'feelings', feelings: 'feelings', mind: 'mind', will: 'will', accord: 'accord',
};

// Сколько дней недели затронуто модулем (регулярность важнее объёма).
function activeDays(entries, keys) {
  return new Set(entries.map((e) => dayKey(e.at))).size;
}

export function weekSummary(journal, now = new Date(), phoneStepsByDate = {}) {
  const keys = daysOfWeek(now);
  const states = journal.state.filter(inKeys(keys));
  const practices = journal.practice.filter(inKeys(keys)).filter((p) => p.payload.completed !== false);
  const meals = journal.meal.filter(inKeys(keys)).filter(alive);
  const wills = journal.will.filter(inKeys(keys));
  const activity = journal.activity.filter((a) => keys.includes(a.payload.date || dayKey(a.at)));

  const byArc = { feelings: [], mind: [], will: [], accord: [] };
  for (const p of practices) {
    const arc = ARC_OF[p.payload.module];
    if (arc) byArc[arc].push(p);
  }
  const willDone = wills.filter((w) => ['done', 'cancelled'].includes(w.payload.status));

  // Дуги: 2+ дня в неделю с активностью модуля — полная дуга (посильность, не максимализм).
  // Питание и воля — один обменно-двигательный полюс (нижняя дуга); раздельные
  // числа остаются в counts, чтобы ничего не терять при слиянии дуг.
  const nutritionArc = clamp01(activeDays(meals, keys) / 4);
  const willArc = clamp01((activeDays(byArc.will, keys) + activeDays(willDone, keys)) / 2);
  const arcs = {
    nutrition: nutritionArc,
    feelings: clamp01(activeDays(byArc.feelings, keys) / 2),
    mind: clamp01(activeDays(byArc.mind, keys) / 2),
    will: willArc,
    lower: clamp01((nutritionArc + willArc) / 2),
  };

  // Ядро — Аккорд: практики согласованности за неделю.
  const core = clamp01(activeDays(byArc.accord, keys) / 2);

  // Регулярность: доля дней недели с любой записью.
  const touched = new Set(
    [...states, ...practices, ...meals, ...willDone].map((e) => dayKey(e.at))
  );
  const density = clamp01(touched.size / 7);

  // Тепло: среднее самочувствие 1–5 → 0..1.
  const stateVals = keys.flatMap((key) =>
    representativeStateValues(states.filter((state) => dayKey(state.at) === key))
  );
  const avgState = stateVals.length
    ? stateVals.reduce((a, b) => a + b, 0) / stateVals.length
    : null;
  const warmth = avgState === null ? 0.5 : clamp01((avgState - 1) / 4);

  // Расширение (тепло · ясность) и собранность (покой · сила) — по каждому
  // дню отдельно, затем усреднены за неделю. warmth выше остаётся сводным
  // числом для цвета силуэта; expansion/gathering не дают этой сводке стереть
  // полярность там, где её видно — в «Динамике».
  const dayPolarities = keys.map((key) =>
    polarity(representativeStateByKey(states.filter((state) => dayKey(state.at) === key))));
  const meanOf = (field) => {
    const values = dayPolarities.map((p) => p[field]).filter((value) => value !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const expansion = meanOf('expansion');
  const gathering = meanOf('gathering');

  // Поток: энергия из трекера (шаги к 8000, сон к 7.5 ч) — без трекера нейтрально.
  // Локальные шаги телефона приоритетнее дневной ручной записи. Это не
  // добавляет их в журнал/резервную копию, но даёт честную визуализацию здесь.
  const steps = keys.map((key) => {
    const phone = Number(phoneStepsByDate?.[key]?.steps);
    if (phone > 0) return phone;
    return activity.filter((a) => (a.payload.date || dayKey(a.at)) === key)
      .map((a) => Number(a.payload.steps)).find((value) => value > 0);
  }).filter((v) => v > 0);
  const sleep = activity.map((a) => Number(a.payload.sleepHours)).filter((v) => v > 0);
  const stepsScore = steps.length ? clamp01(steps.reduce((a, b) => a + b, 0) / steps.length / 8000) : null;
  const sleepScore = sleep.length ? clamp01(sleep.reduce((a, b) => a + b, 0) / sleep.length / 7.5) : null;
  const flowParts = [stepsScore, sleepScore].filter((v) => v !== null);
  const flow = flowParts.length ? flowParts.reduce((a, b) => a + b, 0) / flowParts.length : 0.5;

  // Дельта «до → после» практик за неделю.
  const deltas = practices
    .map((p) => Number(p.payload.delta))
    .filter((v) => Number.isFinite(v));
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

  return {
    keys,
    counts: {
      practices: practices.length,
      meals: meals.length,
      states: states.length,
      willDone: willDone.filter((w) => w.payload.status === 'done').length,
      accord: byArc.accord.length,
    },
    arcs, core, density, warmth, expansion, gathering, flow, avgState, avgDelta,
    activeDayKeys: [...touched],
  };
}

// Чистая функция текущей пищеварительной нагрузки. Вкладка «Питание» сохраняет
// только безопасный график затухания без названий блюд; «Динамика» пересчитывает
// его по текущему времени даже тогда, когда экран питания уже закрыт.
export function digestionNoiseAt(items, now = Date.now()) {
  if (!Array.isArray(items)) return 0;
  let quiet = 1;
  for (const item of items) {
    const load = clamp01(Number(item?.load) || 0);
    const eatenAt = Number(item?.eatenAt);
    const duration = Number(item?.durationMin) * 60000;
    if (!load || !Number.isFinite(eatenAt) || !Number.isFinite(duration) || duration <= 0) continue;
    const elapsed = now - eatenAt;
    if (elapsed < 0 || elapsed > duration) continue;
    const x = elapsed / duration;
    const t = clamp01((x - 0.15) / 0.85);
    const activity = 1 - t * t * (3 - 2 * t);
    quiet *= 1 - Math.min(0.95, load * activity);
  }
  return clamp01(1 - quiet);
}

// КБЖУ за день.
export function kbjuOfDay(meals, key) {
  const day = meals.filter((m) => dayKey(m.at) === key && !m.payload?.deleted);
  const sum = (f) => Math.round(day.reduce((a, m) => a + (Number(m.payload[f]) || 0), 0));
  return { kcal: sum('kcal'), protein: sum('proteinG'), fat: sum('fatG'), carb: sum('carbG'), count: day.length };
}

// «Возвращения»: практика после перерыва ≥ 2 дней — повод отметить, а не стыдить.
export function comebacks(practices) {
  const keys = [...new Set(practices.map((p) => dayKey(p.at)))].sort();
  let n = 0;
  for (let i = 1; i < keys.length; i++) {
    const gap = (new Date(keys[i]) - new Date(keys[i - 1])) / 86400000;
    if (gap >= 3) n++;
  }
  return n;
}

// История недель для мини-тороидов: последние n недель, включая текущую.
export function weekHistory(journal, n = 4, now = new Date(), phoneStepsByDate = {}) {
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const ref = new Date(now);
    ref.setDate(ref.getDate() - 7 * i);
    result.push({ label: i === 0 ? 'эта' : `−${i} нед`, summary: weekSummary(journal, ref, phoneStepsByDate) });
  }
  return result;
}

// Ряд для спарклайна самочувствия по дням (28 дней).
export function stateSeries(states, days = 28, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const vals = representativeStateValues(states.filter((state) => dayKey(state.at) === key));
    out.push({ key, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
  }
  return out;
}
