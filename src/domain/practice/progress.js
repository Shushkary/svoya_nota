const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export const CENTER_CHARGE_RULES = Object.freeze({
  decayPerDay: 0.9,
  sessionCredit: 0.5,
  creditCapMinutes: 20,
});

export function localDayTimestamp(value) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function centerCharge(history, now = new Date(), rules = CENTER_CHARGE_RULES) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const minutesByDay = new Map();
  for (const session of history) {
    const key = localDayTimestamp(session.date);
    const minutes = Math.max(0, Number(session.durationMs) || 0) / 60_000;
    minutesByDay.set(key, (minutesByDay.get(key) || 0) + minutes);
  }
  const days = [...minutesByDay.keys()].sort((a, b) => a - b);
  let charge = 0;
  let cursor = days[0];
  const today = localDayTimestamp(now);
  while (cursor <= today) {
    charge *= rules.decayPerDay;
    if (minutesByDay.has(cursor)) {
      charge += clamp(minutesByDay.get(cursor) / rules.creditCapMinutes, 0, 1)
        * rules.sessionCredit;
    }
    charge = clamp(charge, 0, 1);
    cursor += 86_400_000;
  }
  return charge;
}

export function streakDays(history, now = new Date()) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const days = new Set(history.map((session) => localDayTimestamp(session.date)));
  let cursor = localDayTimestamp(now);
  if (!days.has(cursor)) cursor -= 86_400_000;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 86_400_000;
  }
  return streak;
}

export function weekBuckets(history, now = new Date(), locale = 'ru-RU') {
  const sessions = Array.isArray(history) ? history : [];
  const today = localDayTimestamp(now);
  return Array.from({ length: 7 }, (_, index) => {
    const key = today - (6 - index) * 86_400_000;
    const minutes = sessions
      .filter((session) => localDayTimestamp(session.date) === key)
      .reduce((sum, session) => sum + Math.max(0, Number(session.durationMs) || 0) / 60_000, 0);
    return {
      key,
      min: minutes,
      label: new Date(key).toLocaleDateString(locale, { weekday: 'short' })[0].toUpperCase(),
    };
  });
}
