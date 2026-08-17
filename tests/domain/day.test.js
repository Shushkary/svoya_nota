import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daylightWeight, isEveningWindow, isMorningWindow, medianBedtimeHour, phase, wakeAnchorHour, windowAt, WINDOWS,
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

test('момент подъёма — час первой любой записи дня, медиана за 14 дней', () => {
  const now = new Date(2026, 6, 15, 20, 0);
  const journal = {
    state: [{ at: new Date(2026, 6, 12, 7, 30).toISOString(), payload: {} }],
    meal: [{ at: new Date(2026, 6, 13, 6, 45).toISOString(), payload: {} }],
    activity: [
      { at: new Date(2026, 6, 14, 7, 0).toISOString(), payload: {} },
      { at: new Date(2026, 6, 14, 9, 0).toISOString(), payload: {} }, // тот же день — не первая запись
    ],
    practice: [],
    ritual: [],
  };
  // часы: 7.5, 6.75, 7.0 → медиана 7.0
  assert.equal(wakeAnchorHour(journal, now), 7);
});

test('момент подъёма без данных — null, а не произвольный час', () => {
  const empty = { state: [], meal: [], activity: [], practice: [], ritual: [] };
  assert.equal(wakeAnchorHour(empty, new Date(2026, 6, 15)), null);
});

test('фазовая координата: 0 в подъём, 1 в отбой, ночь продолжается в [1,2)', () => {
  assert.equal(phase(7, 7, 23), 0);
  assert.equal(phase(23, 7, 23), 1);
  assert.equal(phase(15, 7, 23), 0.5);
  assert.ok(phase(2, 7, 23) > 1 && phase(2, 7, 23) < 2, 'глубокая ночь — между 1 и 2');
  assert.equal(phase(NaN, 7, 23), null);
  assert.equal(phase(10, null, 23), null);
});

test('фазовая координата одинакова для жаворонка и совы в их же ритме', () => {
  const lark = phase(11, 6, 22); // полдень для жаворонка (подъём в 6)
  const owl = phase(15, 10, 26 % 24); // тот же относительный момент для совы (подъём в 10, отбой в 2 ночи)
  assert.ok(Math.abs(lark - owl) < 1e-9);
});

test('windowAt находит окно по φ, включая границы диапазона', () => {
  assert.equal(windowAt(0), 'lightAndMovement');
  assert.equal(windowAt(0.07), 'lightAndMovement');
  assert.equal(windowAt(0.08), 'mealAndAssimilation');
  assert.equal(windowAt(0.5), 'mealAndAssimilation');
  assert.equal(windowAt(0.6), 'activity');
  assert.equal(windowAt(0.85), 'closing');
  assert.equal(windowAt(1), 'nightFast');
  assert.equal(windowAt(1.99), 'nightFast');
  assert.equal(windowAt(2), null, 'вне объявленного диапазона');
  assert.equal(windowAt(null), null);
  assert.equal(windowAt(NaN), null);
});

test('окна суток объявлены один раз и покрывают [0,2) без дыр', () => {
  const ranges = Object.values(WINDOWS);
  assert.equal(ranges[0][0], 0);
  assert.equal(ranges.at(-1)[1], 2);
  for (let i = 1; i < ranges.length; i += 1) {
    assert.equal(ranges[i][0], ranges[i - 1][1], `окно ${i} не стыкуется с предыдущим`);
  }
});
