// Смысл отметок состояния не зависит от экрана и способа хранения.
// Новая модель различает снимок текущего момента и один репрезентативный итог дня.

export const STATE_PHASE = Object.freeze({
  MOMENT: 'moment',
  DAY_SUMMARY: 'day-summary',
});

export const STATE_VALUE_KEYS = Object.freeze(['calm', 'energy', 'clarity', 'warmth']);

const score = (value) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(5, number)) : 3;
};

export function statePhase(payload = {}) {
  if (payload.phase === STATE_PHASE.DAY_SUMMARY || payload.phase === 'evening') {
    return STATE_PHASE.DAY_SUMMARY;
  }
  // Утренние записи старых версий остаются моментальными замерами.
  return STATE_PHASE.MOMENT;
}

export function statePayload(values, phase) {
  return {
    ...Object.fromEntries(STATE_VALUE_KEYS.map((key) => [key, score(values?.[key])])),
    phase: phase === STATE_PHASE.DAY_SUMMARY ? STATE_PHASE.DAY_SUMMARY : STATE_PHASE.MOMENT,
  };
}

export function latestState(entries = [], phase = STATE_PHASE.MOMENT) {
  return entries
    .filter((entry) => statePhase(entry?.payload) === phase)
    .sort((left, right) => String(right?.at || '').localeCompare(String(left?.at || '')))[0] || null;
}

export function openingState(entries = []) {
  const legacyMorning = entries.find((entry) => entry?.payload?.phase === 'morning');
  if (legacyMorning) return legacyMorning;
  return entries
    .filter((entry) => statePhase(entry?.payload) === STATE_PHASE.MOMENT)
    .sort((left, right) => String(left?.at || '').localeCompare(String(right?.at || '')))[0] || null;
}

// Для аналитики один активно отмечаемый день не должен весить больше другого.
// Явный итог дня приоритетен; без него берём среднее моментальных замеров.
export function representativeStateValues(entries = []) {
  const summary = latestState(entries, STATE_PHASE.DAY_SUMMARY);
  if (summary) {
    return STATE_VALUE_KEYS
      .map((key) => Number(summary.payload?.[key]))
      .filter((value) => value >= 1 && value <= 5);
  }

  const moments = entries.filter((entry) => statePhase(entry?.payload) === STATE_PHASE.MOMENT);
  return STATE_VALUE_KEYS.flatMap((key) => {
    const values = moments
      .map((entry) => Number(entry.payload?.[key]))
      .filter((value) => value >= 1 && value <= 5);
    return values.length ? [values.reduce((sum, value) => sum + value, 0) / values.length] : [];
  });
}

// Тот же расчёт, что representativeStateValues, но по каждой оси отдельно —
// без этого усреднение по дню стирает разницу между «тепло и ясно» и
// «спокойно и с силой» ещё до того, как её можно увидеть.
export function representativeStateByKey(entries = []) {
  const summary = latestState(entries, STATE_PHASE.DAY_SUMMARY);
  if (summary) {
    return Object.fromEntries(STATE_VALUE_KEYS.map((key) => {
      const value = Number(summary.payload?.[key]);
      return [key, value >= 1 && value <= 5 ? value : null];
    }));
  }

  const moments = entries.filter((entry) => statePhase(entry?.payload) === STATE_PHASE.MOMENT);
  return Object.fromEntries(STATE_VALUE_KEYS.map((key) => {
    const values = moments
      .map((entry) => Number(entry.payload?.[key]))
      .filter((value) => value >= 1 && value <= 5);
    return [key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  }));
}

// Две сводные оси вместо одной: расширение (тепло · ясность) и собранность
// (покой · сила). Их усреднение в одно число стирает полярность — человек с
// высоким теплом и низким покоем и человек с обратной картиной по-разному
// выглядят на плоскости, но одинаково — в единственном скаляре.
export function polarity(values = {}) {
  const norm = (raw) => {
    const number = Number(raw);
    return number >= 1 && number <= 5 ? (number - 1) / 4 : null;
  };
  const mean = (list) => {
    const present = list.filter((value) => value !== null);
    return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
  };
  return {
    expansion: mean([norm(values.warmth), norm(values.clarity)]),
    gathering: mean([norm(values.calm), norm(values.energy)]),
  };
}
