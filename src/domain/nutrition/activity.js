const clamp = (value, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
};

export const ACTIVITY_MET = Object.freeze({
  walk_low: 2.8,
  walk_brisk: 3.8,
  run: 9.8,
  cycling: 7,
  strength: 5,
  hiit: 9,
  yoga: 2.5,
  swim: 8.0,
  banya: 2.0,
});

// Оценка активности без привязки к весу (маркировка «оценка», не персональная норма).
export function estimateActivityCalories(type, durationMin) {
  const met = ACTIVITY_MET[type] || ACTIVITY_MET.walk_brisk;
  return Math.round(met * (clamp(durationMin, 0, 1440) / 60));
}

export function estimateStepCalories(steps, heightCm) {
  const strideMetres = 0.415 * (clamp(heightCm, 120, 230) / 100);
  const distanceKm = clamp(steps, 0, 100_000) * strideMetres / 1000;
  // нейтральная оценка походки без веса (маркировка «оценка»)
  return Math.round(distanceKm * 50);
}

export function findFreeActivityStart(activities, requestedStartMin, durationMin) {
  const duration = clamp(durationMin, 0, 1440);
  let start = clamp(requestedStartMin, 0, 1440 - duration);
  const intervals = (activities || [])
    .map((activity) => ({
      start: clamp(activity.startMin, 0, 1440),
      end: clamp(activity.startMin, 0, 1440) + clamp(activity.durationMin ?? activity.dur, 0, 1440),
    }))
    .sort((left, right) => left.start - right.start);

  for (let guard = 0; guard < 64; guard += 1) {
    const collision = intervals.find((item) => start < item.end && start + duration > item.start);
    if (!collision) return Math.round(start);
    start = collision.end;
    if (start + duration > 1440) return Math.max(0, 1440 - duration);
  }
  return Math.round(start);
}

// В пересекающуюся минуту учитывается только самая энергозатратная запись.
export function dailyActivityExpenditure(activities) {
  const perMinute = new Array(1440).fill(0);
  for (const activity of activities || []) {
    const start = clamp(activity.startMin, 0, 1440);
    const duration = clamp(activity.durationMin ?? activity.dur, 0, 1440);
    const end = Math.min(1440, start + duration);
    const rate = duration > 0 ? clamp(activity.kcal, 0, 100_000) / duration : 0;
    for (let minute = Math.floor(start); minute < end; minute += 1) {
      perMinute[minute] = Math.max(perMinute[minute], rate);
    }
  }
  return Math.round(perMinute.reduce((sum, value) => sum + value, 0));
}

const FUEL_BY_INTENSITY = Object.freeze({
  low: { protein: 0.05, carb: 0.30, fat: 0.65, sweatLph: 0.3 },
  moderate: { protein: 0.05, carb: 0.50, fat: 0.45, sweatLph: 0.6 },
  high: { protein: 0.05, carb: 0.75, fat: 0.20, sweatLph: 0.9 },
});

const LOW_CARB_FUEL_BY_INTENSITY = Object.freeze({
  low: { protein: 0.05, carb: 0.20, fat: 0.75, sweatLph: 0.3 },
  moderate: { protein: 0.05, carb: 0.40, fat: 0.55, sweatLph: 0.6 },
  high: { protein: 0.05, carb: 0.65, fat: 0.30, sweatLph: 0.9 },
});

const LOCOMOTION = new Set(['walk_low', 'walk_brisk', 'run']);

// Приблизительная связь активности с кольцами питания. Без пульса, температуры,
// влажности и анализа пота это модель, а не измерение расхода субстратов/электролитов.
export function estimateActivityNutritionImpact(activities, { weightKg = 70, lowCarb = false } = {}) {
  const mass = clamp(weightKg, 35, 250) || 70;
  const rows = (activities || []).filter((item) => item && typeof item === 'object');
  const hasDailySteps = rows.some((item) => item.dailySteps && Number(item.steps) > 0);
  const perMinute = new Array(1440).fill(null);

  for (const activity of rows) {
    if (hasDailySteps && !activity.dailySteps && LOCOMOTION.has(activity.type)) continue;
    const start = clamp(activity.startMin, 0, 1439);
    const duration = clamp(activity.durationMin ?? activity.dur, 0, 1440);
    if (!duration) continue;
    const end = Math.min(1440, start + duration);
    const intensity = ['low', 'moderate', 'high'].includes(activity.intensity)
      ? activity.intensity : 'moderate';
    const fuel = (lowCarb ? LOW_CARB_FUEL_BY_INTENSITY : FUEL_BY_INTENSITY)[intensity];
    const met = ACTIVITY_MET[activity.type] || ACTIVITY_MET.walk_brisk;
    const intensityFactor = intensity === 'low' ? 0.85 : intensity === 'high' ? 1.15 : 1;
    const estimatedRate = Math.max(0, (met * intensityFactor - 1) * 3.5 * mass / 200);
    const suppliedRate = activity.dailySteps && Number(activity.kcal) > 0
      ? clamp(activity.kcal, 0, 5000) / duration : null;
    const kcalPerMin = suppliedRate ?? estimatedRate;
    const sweatLph = activity.type === 'banya' ? 0.8 : fuel.sweatLph;
    for (let minute = Math.floor(start); minute < end; minute += 1) {
      if (!perMinute[minute] || kcalPerMin > perMinute[minute].kcalPerMin) {
        perMinute[minute] = { kcalPerMin, fuel, sweatLph };
      }
    }
  }

  let energyKcal = 0;
  let proteinKcal = 0;
  let carbKcal = 0;
  let fatKcal = 0;
  let sweatLitres = 0;
  for (const minute of perMinute) if (minute) {
    energyKcal += minute.kcalPerMin;
    proteinKcal += minute.kcalPerMin * minute.fuel.protein;
    carbKcal += minute.kcalPerMin * minute.fuel.carb;
    fatKcal += minute.kcalPerMin * minute.fuel.fat;
    sweatLitres += minute.sweatLph / 60;
  }

  // Срединные коэффициенты нужны только для интерфейсной оценки. Реальные
  // концентрации пота широко различаются, поэтому добавки по модели не назначаются.
  return {
    energyKcal: Math.round(clamp(energyKcal, 0, 5000)),
    proteinG: Math.round(clamp(proteinKcal / 4, 0, 100) * 10) / 10,
    carbG: Math.round(clamp(carbKcal / 4, 0, 500) * 10) / 10,
    fatG: Math.round(clamp(fatKcal / 9, 0, 300) * 10) / 10,
    fiberG: 0,
    sodiumMg: Math.round(clamp(sweatLitres * 500, 0, 1500)),
    potassiumMg: Math.round(clamp(sweatLitres * 200, 0, 600)),
    magnesiumMg: Math.round(clamp(sweatLitres * 10, 0, 50)),
    sweatLitres: Math.round(clamp(sweatLitres, 0, 5) * 100) / 100,
    model: 'activity-fuel-sweat-v1',
  };
}
