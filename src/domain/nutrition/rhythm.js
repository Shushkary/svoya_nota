// Суточные правила питания. Модуль не зависит от React, DOM, часов устройства и сети.

export const MINUTES_PER_DAY = 24 * 60;

export function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

export function normalizeHour(value) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return 0;
  return ((hour % 24) + 24) % 24;
}

export function formatHour(value) {
  const minutes = ((Math.round(normalizeHour(value) * 60) % MINUTES_PER_DAY) + MINUTES_PER_DAY)
    % MINUTES_PER_DAY;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function mealType(hour) {
  const value = normalizeHour(hour);
  if (value >= 5 && value < 11) return 'завтрак';
  if (value >= 11 && value < 16) return 'обед';
  if (value >= 18 && value < 23) return 'ужин';
  return 'перекус';
}

export function smoothstep(min, max, value) {
  if (max <= min) return value >= max ? 1 : 0;
  const position = clamp((value - min) / (max - min), 0, 1);
  return position * position * (3 - 2 * position);
}

// Плавное дневное окно, совпадающее с действующим визуальным алгоритмом.
export function daylightWeight(hour, transitionHours = 1.2) {
  return clamp(
    smoothstep(7 - transitionHours, 7 + transitionHours, normalizeHour(hour))
      - smoothstep(14 - transitionHours, 14 + transitionHours, normalizeHour(hour)),
    0,
    1,
  );
}

export function hourToAngle(hour, minute = 0) {
  return ((normalizeHour(hour) * 60 + clamp(minute, 0, 59)) / MINUTES_PER_DAY) * Math.PI * 2;
}
