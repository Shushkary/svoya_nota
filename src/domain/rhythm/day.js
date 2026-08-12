// Единая форма дня. Раньше окна питания, вечернего дыхания и утреннего
// напоминания жили порознь в трёх файлах — каждое со своим магическим числом.
// Здесь одна объявленная кривая и именованные окна поверх неё; остальной код
// ссылается на них вместо того, чтобы зашивать часы в компонент.
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

export function smoothstep(min, max, value) {
  if (max <= min) return value >= max ? 1 : 0;
  const position = clamp((value - min) / (max - min), 0, 1);
  return position * position * (3 - 2 * position);
}

// Плавное дневное окно (используется и питанием, и визуализацией тороида).
export function daylightWeight(hour, transitionHours = 1.2) {
  return clamp(
    smoothstep(7 - transitionHours, 7 + transitionHours, normalizeHour(hour))
      - smoothstep(14 - transitionHours, 14 + transitionHours, normalizeHour(hour)),
    0,
    1,
  );
}

// Вечернее окно дыхательного напоминания.
export function isEveningWindow(date = new Date()) {
  const hour = date.getHours();
  return hour >= 21 && hour < 23;
}

// Утреннее окно ритуала с электролитами.
export function isMorningWindow(date = new Date()) {
  return date.getHours() < 12;
}

// Медиана времени отхода ко сну за последние N дней — вместо фиксированного
// часа (был магическим числом 18:00 в правиле «переваривание закончится
// вовремя»). Ночные часы (после полуночи) продолжают вечер предыдущего дня,
// поэтому перед медианой их сдвигают на +24 — иначе 23:30 и 0:30 разрывались
// бы на разных концах шкалы, хотя по факту это соседние отметки.
export function medianBedtimeHour(activities = [], now = new Date(), days = 14) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const hours = (activities || [])
    .filter((entry) => !entry?.payload?.deleted && new Date(entry.at) >= cutoff)
    .map((entry) => Number(entry.payload?.bedtimeHour))
    .filter((hour) => Number.isFinite(hour) && hour >= 0 && hour < 24)
    .map((hour) => (hour < 12 ? hour + 24 : hour))
    .sort((a, b) => a - b);
  if (!hours.length) return null;
  const mid = Math.floor(hours.length / 2);
  const median = hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
  return median % 24;
}
