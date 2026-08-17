import assert from 'node:assert/strict';
import test from 'node:test';

import { tactOrder14 } from '../../src/domain/loop.js';

const NOW = new Date(2026, 6, 20, 12, 0, 0);

function dayAt(offsetDays, hour, minute = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function dateKey(offsetDays) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function meal(offsetDays, hour) {
  return { at: dayAt(offsetDays, Math.floor(hour), Math.round((hour % 1) * 60)).toISOString(), payload: { mealHour: hour } };
}
function loadActivity(offsetDays, startHour, durationMin = 30) {
  return { at: dayAt(offsetDays, Math.floor(startHour)).toISOString(), payload: { startMin: Math.round(startHour * 60), durationMin, date: dateKey(offsetDays) } };
}
function sleepRecord(offsetDays, hours = 7) {
  return { at: dayAt(offsetDays, 7).toISOString(), payload: { sleepHours: hours, date: dateKey(offsetDays) } };
}
function bedtime(offsetDays, hour = 23) {
  return { at: dayAt(offsetDays, 7).toISOString(), payload: { bedtimeHour: hour, date: dateKey(offsetDays) } };
}
function willPractice(offsetDays, hour) {
  return { at: dayAt(offsetDays, hour).toISOString(), payload: { module: 'will', completed: true } };
}

test('день с тактами в порядке (приём → нагрузка → сон) засчитывается', () => {
  const journal = {
    meal: [meal(0, 8)],
    activity: [loadActivity(0, 10, 60), sleepRecord(0), bedtime(0, 23)],
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 1);
});

test('еда после нагрузки в конце дня — день не засчитывается', () => {
  const journal = {
    meal: [meal(0, 21)], // ужин в 21:00
    activity: [loadActivity(0, 10, 60), sleepRecord(0), bedtime(0, 23)], // нагрузка закончилась в 11:00
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 0);
});

test('движение после отбоя — день не засчитывается', () => {
  const journal = {
    meal: [meal(0, 8)],
    activity: [loadActivity(0, 23.67, 30), sleepRecord(0), bedtime(0, 23)], // нагрузка до ~00:10
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 0);
});

test('день без одного из тактов не засчитывается, но и не роняет остальные', () => {
  const journal = {
    meal: [meal(0, 8), meal(1, 8)],
    activity: [
      // день 0: есть еда и сон, но нет нагрузки — не засчитан
      sleepRecord(0), bedtime(0, 23),
      // день 1: полный набор тактов в порядке — засчитан
      loadActivity(1, 10, 60), sleepRecord(1), bedtime(1, 23),
    ],
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 1);
});

test('телесная волевая практика считается тактом «нагрузка» наравне с активностью', () => {
  const journal = {
    meal: [meal(0, 8)],
    activity: [sleepRecord(0), bedtime(0, 23)],
    practice: [willPractice(0, 12)], // «Двадцать шагов» и подобные — module: 'will'
  };
  assert.equal(tactOrder14(journal, NOW), 1);
});

test('дневной итог шагов без времени не считается тактом «нагрузка»', () => {
  const journal = {
    meal: [meal(0, 8)],
    activity: [
      { at: dayAt(0, 12).toISOString(), payload: { dailySteps: true, startMin: 700, durationMin: 80, date: dateKey(0) } },
      sleepRecord(0), bedtime(0, 23),
    ],
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 0, 'без реальной нагрузки такт отсутствует');
});

test('удалённые записи не участвуют в проверке порядка', () => {
  const journal = {
    meal: [meal(0, 8)],
    activity: [
      { ...loadActivity(0, 10, 60), payload: { ...loadActivity(0, 10, 60).payload, deleted: true } },
      sleepRecord(0), bedtime(0, 23),
    ],
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 0, 'удалённая нагрузка не считается тактом');
});

test('плотность за 14 дней, а не серия: несколько удачных дней считаются независимо', () => {
  const journal = {
    meal: [meal(0, 8), meal(2, 8), meal(5, 8)],
    activity: [
      loadActivity(0, 10, 60), sleepRecord(0), bedtime(0, 23),
      loadActivity(2, 10, 60), sleepRecord(2), bedtime(2, 23),
      // день 5: нет сна — не засчитан
      loadActivity(5, 10, 60),
    ],
    practice: [],
  };
  assert.equal(tactOrder14(journal, NOW), 2);
});
