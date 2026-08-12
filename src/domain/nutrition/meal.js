import { clamp, smoothstep } from './rhythm.js';

export const PROCESSING_MODEL_VERSION = 2;

export const PROCESSING_TERMS = Object.freeze({
  ultra: ['газиров', 'чипс', 'наггет', 'фастфуд', 'лапша быстр', 'сухарик', 'энергетик', 'конфет', 'батончик', 'плавлен', 'заменитель молочного жира'],
  processed: ['колбас', 'сосиск', 'ветчин', 'копч', 'консерв', 'майонез', 'готовый соус', 'печенье', 'выпечк'],
  minimal: ['яич', 'яйц', 'зелень', 'овощ', 'салат', 'рыб', 'куриц', 'индей', 'мяс', 'греч', 'рис', 'овся', 'творог', 'фрукт', 'ягод', 'орех', 'гриб'],
});

const numberOr = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const REPEAT_NUTRIENTS = Object.freeze([
  ['kcal', 0],
  ['proteinG', 1],
  ['fatG', 1],
  ['carbG', 1],
  ['fiberG', 1],
  ['sodiumMg', 0],
  ['potassiumMg', 0],
  ['magnesiumMg', 0],
]);

export function scaleMealPayload(payload, factor) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const portionFactor = clamp(numberOr(factor, 1), 0.25, 3);
  const scaled = { ...source };
  for (const [key, digits] of REPEAT_NUTRIENTS) {
    const multiplier = 10 ** digits;
    scaled[key] = Math.round(numberOr(source[key]) * portionFactor * multiplier) / multiplier;
  }
  if (Array.isArray(source.components)) {
    scaled.components = source.components.map((component) => {
      const next = { ...component, portionG: Math.round(numberOr(component.portionG) * portionFactor * 10) / 10 };
      for (const [key, digits] of REPEAT_NUTRIENTS) {
        const multiplier = 10 ** digits;
        if (component[key] != null) next[key] = Math.round(numberOr(component[key]) * portionFactor * multiplier) / multiplier;
      }
      return next;
    });
  }
  scaled.repeatPortionFactor = portionFactor;
  scaled.digestionH = estimateDigestionHours({
    kcal: scaled.kcal,
    p: scaled.proteinG,
    f: scaled.fatG,
    c: scaled.carbG,
    fiber: scaled.fiberG,
  });
  return scaled;
}

// Кольцо показывает фактический процент, даже когда ориентир превышен.
// Дуга при этом физически ограничена полным кругом.
export function nutrientProgress(value, target) {
  const safeTarget = numberOr(target);
  const actualRatio = safeTarget > 0 ? Math.max(0, numberOr(value) / safeTarget) : 0;
  return {
    ratio: Math.min(1, actualRatio),
    percent: Math.round(actualRatio * 100),
  };
}

// Цвет пищевого сегмента зависит от прогноза окончания переваривания, а не
// только от часа приёма. Значение ровно на границе считается завершившимся к ней.
export function digestionFinishesBy(mealHour, digestionHours, cutoffHour = 18) {
  const start = numberOr(mealHour, -1);
  const duration = numberOr(digestionHours, -1);
  const cutoff = numberOr(cutoffHour, 18);
  if (start < 0 || start >= 24 || duration < 0 || cutoff < 0 || cutoff > 24) return false;
  return start + duration <= cutoff;
}

export function estimateProcessing(name, confidence) {
  const normalized = String(name || '').toLowerCase();
  const contains = (terms) => terms.some((term) => normalized.includes(term));
  const position = contains(PROCESSING_TERMS.ultra)
    ? 0.9
    : contains(PROCESSING_TERMS.processed)
      ? 0.67
      : contains(PROCESSING_TERMS.minimal) ? 0.2 : 0.35;
  // Уверенность оценки КБЖУ не является уверенностью классификации обработки.
  return { pos: position, cf: Number(confidence) >= 0.75 ? 'средняя' : 'низкая' };
}

export function estimateDigestionHours(meal) {
  const source = meal || {};
  return clamp(
    1.5
      + numberOr(source.kcal) / 400
      + numberOr(source.f) * 0.03
      + numberOr(source.p) * 0.02
      + numberOr(source.fiber) * 0.04,
    1.5,
    5,
  );
}

// ── Влияние активности на время переваривания приёма ────────────────────────
// Условная эвристика (не физиологическая модель): отражает известное НАПРАВЛЕНИЕ
// эффекта, а не его точную величину.
//   < 0 — облегчает опорожнение желудка (лёгкое движение после еды: прогулка, йога)
//   > 0 — задерживает (интенсивная нагрузка и жара отвлекают кровоток от ЖКТ:
//         бег, HIIT, плавание, силовая, а также баня/сауна)
const DIGEST_EFFECT = Object.freeze({
  walk_low: -0.25, walk_brisk: -0.20,
  yoga: -0.15,
  cycling: 0.20, strength: 0.25, run: 0.45, hiit: 0.50, swim: 0.45,
  banya: 0.30,
});
const INTENSITY_SCALE = Object.freeze({ low: 0.5, moderate: 1.0, high: 1.6 });

function mealMinutesOfDay(meal) {
  const source = meal || {};
  if (Number.isFinite(Number(source.eatenAt))) {
    const d = new Date(source.eatenAt);
    return d.getHours() * 60 + d.getMinutes();
  }
  return Number(source.hour) * 60;
}

// Суммарный сдвиг окна переваривания (в часах) только от активностей,
// которые действительно пересекают базовое окно конкретного приёма.
export function mealDigestionShift(meal, activities) {
  const source = meal || {};
  const mm = mealMinutesOfDay(meal);
  const baseHours = Number(source.digestionH) > 0 ? source.digestionH : estimateDigestionHours(source);
  const digestionEnd = mm + baseHours * 60;
  let shift = 0;
  for (const entry of (activities || [])) {
    const a = (entry && entry.payload) || entry || {};
    if (a.deleted) continue;
    const type = a.type;
    if (!(type in DIGEST_EFFECT)) continue;
    const start = Number(a.startMin) || 0;
    const end = start + (Number(a.durationMin) || 0);
    const overlapStart = Math.max(mm, start);
    const overlapMinutes = Math.max(0, Math.min(digestionEnd, end) - overlapStart);
    if (overlapMinutes <= 0) continue;
    // 30 минут дают полный вес длительности; более поздняя активность влияет
    // мягче, чем начатая вскоре после еды.
    const durationWeight = clamp(overlapMinutes / 30, 0, 1);
    const timingWeight = 1 - 0.5 * clamp((overlapStart - mm) / (baseHours * 60), 0, 1);
    const intensity = INTENSITY_SCALE[a.intensity]
      ?? (a.high ? 1.6 : a.low ? 0.5 : 1.0);
    shift += DIGEST_EFFECT[type] * intensity * durationWeight * timingWeight;
  }
  return shift; // отрицательный — короче, положительный — дольше
}

// Эффективное окно переваривания с учётом активностей рядом с приёмом.
export function effectiveDigestionHours(meal, activities) {
  const source = meal || {};
  const base = Number(source.digestionH) > 0 ? source.digestionH : estimateDigestionHours(source);
  return clamp(base + mealDigestionShift(meal, activities), 1.0, 6.5);
}

// Эвристика интерфейса, а не медицинский показатель.
export function digestiveLoad(meal) {
  const source = meal || {};
  return clamp(
    0.35 * clamp(numberOr(source.kcal) / 700, 0, 1)
      + 0.30 * clamp(numberOr(source.f) / 35, 0, 1)
      + 0.15 * clamp(numberOr(source.p) / 45, 0, 1)
      + 0.10 * clamp(numberOr(source.fiber) / 15, 0, 1)
      + 0.10 * clamp(numberOr(source.c) / 100, 0, 1),
    0.04,
    1,
  );
}

export function mealTimestamp(hour, now = new Date()) {
  const timestamp = new Date(now);
  const totalMinutes = Math.round(numberOr(hour) * 60);
  timestamp.setHours(Math.floor(totalMinutes / 60) % 24, totalMinutes % 60, 0, 0);
  if (timestamp.getTime() - now.getTime() > 6 * 60 * 60 * 1000) {
    timestamp.setDate(timestamp.getDate() - 1);
  }
  return timestamp.getTime();
}

export function normalizeMeal(meal, now = new Date()) {
  const source = meal && typeof meal === 'object' ? meal : {};
  const normalized = {
    ...source,
    name: String(source.name || 'Приём пищи').trim().slice(0, 80) || 'Приём пищи',
    kcal: clamp(source.kcal, 0, 10_000),
    p: clamp(source.p, 0, 1_000),
    f: clamp(source.f, 0, 1_000),
    c: clamp(source.c, 0, 1_000),
    fiber: clamp(source.fiber, 0, 1_000),
    sodium: clamp(source.sodium, 0, 20_000),
    potassium: clamp(source.potassium, 0, 20_000),
    magnesium: clamp(source.magnesium, 0, 5_000),
  };
  normalized.eatenAt = Number.isFinite(Number(source.eatenAt))
    ? Number(source.eatenAt)
    : mealTimestamp(source.hour, now);
  normalized.digestionH = Number(source.digestionH) > 0
    ? clamp(source.digestionH, 0.25, 12)
    : estimateDigestionHours(normalized);
  if (source.source !== 'barcode' && source.processingVersion !== PROCESSING_MODEL_VERSION) {
    normalized.proc = estimateProcessing(normalized.name, source.confidence);
    normalized.processingVersion = PROCESSING_MODEL_VERSION;
  }
  return normalized;
}

export function digestionActivityAt(meal, now = new Date(), digestionH = null) {
  const normalized = normalizeMeal(meal, now);
  const h = Number(digestionH) > 0 ? digestionH : normalized.digestionH;
  const elapsedMinutes = (now.getTime() - normalized.eatenAt) / 60_000;
  const durationMinutes = h * 60;
  // Будущий приём не создаёт текущую пищеварительную нагрузку.
  if (elapsedMinutes < 0 || elapsedMinutes > durationMinutes) return 0;
  return 1 - smoothstep(0.15, 1, elapsedMinutes / durationMinutes);
}

export function clampMealTimestamp(timestamp, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const requestedMs = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(nowMs)) return Number.isFinite(requestedMs) ? requestedMs : 0;
  if (!Number.isFinite(requestedMs)) return nowMs;
  return Math.min(requestedMs, nowMs);
}

export function combinedDigestiveLoad(meals, now = new Date(), activities = []) {
  let quiet = 1;
  for (const meal of meals || []) {
    const h = effectiveDigestionHours(meal, activities);
    quiet *= 1 - clamp(digestiveLoad(meal) * digestionActivityAt(meal, now, h), 0, 0.95);
  }
  return clamp(1 - quiet, 0, 1);
}

// ── Суточное кольцо: еда, движение и покой на одной оси ─────────────────────
// Еда и движение сейчас встречаются только в знаменателе колец «% от цели».
// Здесь — прямое измерение того, как они чередуются во времени: доля суток
// с наложением, самое длинное окно покоя, час завершения последнего
// переваривания. Ни одно из этих чисел не имеет цели или нормы.
const MINUTES_PER_DAY = 24 * 60;

function activityCoversMinute(activities, minute) {
  return (activities || []).some((entry) => {
    const a = (entry && entry.payload) || entry || {};
    if (a.deleted) return false;
    const start = numberOr(a.startMin);
    const end = start + numberOr(a.durationMin);
    return minute >= start && minute < end;
  });
}

// Карта суток с шагом stepMinutes: идёт ли переваривание, идёт ли движение.
function dayCoverage(meals, activities, now, stepMinutes = 5) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const digesting = [];
  const moving = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += stepMinutes) {
    const at = new Date(dayStart.getTime() + minute * 60_000);
    const isDigesting = (meals || []).some((meal) => {
      const hours = effectiveDigestionHours(meal, activities);
      return digestionActivityAt(meal, at, hours) > 0.02;
    });
    digesting.push(isDigesting);
    moving.push(activityCoversMinute(activities, minute));
  }
  return { digesting, moving, stepMinutes };
}

// Доля суток, где переваривание и движение идут одновременно.
export function digestionMovementOverlapShare(meals, activities, now = new Date()) {
  const { digesting, moving } = dayCoverage(meals, activities, now);
  if (!digesting.length) return 0;
  const overlapSteps = digesting.filter((isDigesting, index) => isDigesting && moving[index]).length;
  return clamp(overlapSteps / digesting.length, 0, 1);
}

// Самое длинное непрерывное окно суток без переваривания, в минутах.
export function longestRestWindowMinutes(meals, activities, now = new Date()) {
  const { digesting, stepMinutes } = dayCoverage(meals, activities, now);
  let longest = 0;
  let current = 0;
  for (const isDigesting of digesting) {
    if (isDigesting) { current = 0; } else { current += stepMinutes; longest = Math.max(longest, current); }
  }
  return longest;
}

// Час завершения последнего переваривания за день (может быть > 24 — за полночь).
// null, если приёмов нет.
export function lastDigestionFinishHour(meals, activities) {
  let latest = null;
  for (const meal of (meals || [])) {
    const source = meal || {};
    const mealHour = Number.isFinite(Number(source.hour))
      ? Number(source.hour)
      : Number.isFinite(Number(source.eatenAt))
        ? new Date(source.eatenAt).getHours() + new Date(source.eatenAt).getMinutes() / 60
        : null;
    if (mealHour === null) continue;
    const hours = effectiveDigestionHours(source, activities);
    const finish = mealHour + hours;
    if (latest === null || finish > latest) latest = finish;
  }
  return latest;
}

export function processingScore(meals) {
  let score = 0;
  let weight = 0;
  for (const rawMeal of meals || []) {
    const meal = normalizeMeal(rawMeal);
    const kcal = meal.kcal;
    score += numberOr(meal.proc?.pos, 0.35) * kcal;
    weight += kcal;
  }
  return weight > 0 ? score / weight : 0;
}

export function aggregateMeals(meals) {
  return (meals || []).reduce((total, rawMeal) => {
    const meal = normalizeMeal(rawMeal);
    return {
      kcal: total.kcal + meal.kcal,
      p: total.p + meal.p,
      f: total.f + meal.f,
      c: total.c + meal.c,
      fiber: total.fiber + meal.fiber,
      sodium: total.sodium + (meal.sodium || 0),
      potassium: total.potassium + (meal.potassium || 0),
      magnesium: total.magnesium + (meal.magnesium || 0),
    };
  }, { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, sodium: 0, potassium: 0, magnesium: 0 });
}
