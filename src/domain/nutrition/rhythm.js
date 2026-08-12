// Суточные правила питания. Модуль не зависит от React, DOM, часов устройства и сети.
// Общая форма дня (сглаживание, дневное окно) объявлена один раз в
// domain/rhythm/day.js — здесь только то, что специфично для питания.
import { clamp, daylightWeight, MINUTES_PER_DAY, normalizeHour, smoothstep } from '../rhythm/day.js';

export { clamp, daylightWeight, MINUTES_PER_DAY, normalizeHour, smoothstep };

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

export function hourToAngle(hour, minute = 0) {
  return ((normalizeHour(hour) * 60 + clamp(minute, 0, 59)) / MINUTES_PER_DAY) * Math.PI * 2;
}
