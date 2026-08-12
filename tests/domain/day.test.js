import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daylightWeight, isEveningWindow, isMorningWindow, medianBedtimeHour,
} from '../../src/domain/rhythm/day.js';

test('единая форма дня используется питанием и напоминаниями', () => {
  assert.equal(isMorningWindow(new Date(2026, 6, 1, 9, 0)), true);
  assert.equal(isMorningWindow(new Date(2026, 6, 1, 13, 0)), false);
  assert.equal(isEveningWindow(new Date(2026, 6, 1, 21, 30)), true);
  assert.equal(isEveningWindow(new Date(2026, 6, 1, 20, 59)), false);
  assert.ok(daylightWeight(10) > daylightWeight(2));
});

test('медиана времени отхода ко сну — без данных возвращает null, не 0', () => {
  assert.equal(medianBedtimeHour([], new Date(2026, 6, 15)), null);
});

test('ночные часы после полуночи считаются продолжением вечера при медиане', () => {
  const now = new Date(2026, 6, 15, 12, 0);
  const activities = [
    { at: '2026-07-10T12:00:00Z', payload: { bedtimeHour: 23 } },
    { at: '2026-07-11T12:00:00Z', payload: { bedtimeHour: 23.5 } },
    { at: '2026-07-12T12:00:00Z', payload: { bedtimeHour: 0.5 } },
  ];
  const median = medianBedtimeHour(activities, now);
  // 23, 23.5, 24.5 (0.5+24) → медиана 23.5
  assert.equal(median, 23.5);
});

test('медиана считается только за последние N дней и игнорирует удалённые записи', () => {
  const now = new Date(2026, 6, 15, 12, 0);
  const activities = [
    { at: '2026-05-01T12:00:00Z', payload: { bedtimeHour: 1 } }, // слишком старая
    { at: '2026-07-10T12:00:00Z', payload: { bedtimeHour: 23, deleted: true } }, // удалена
    { at: '2026-07-12T12:00:00Z', payload: { bedtimeHour: 22 } },
  ];
  assert.equal(medianBedtimeHour(activities, now, 14), 22);
});
