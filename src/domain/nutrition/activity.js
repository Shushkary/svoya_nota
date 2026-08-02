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
