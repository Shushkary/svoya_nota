import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adherence,
  breathCount,
  breathingCoherence,
  cycleSeconds,
  paceBpm,
  phaseAt,
  phasesFor,
  pulseSignalSummary,
  rmssd,
} from '../../src/domain/practice/breathing.js';
import { centerCharge, streakDays, weekBuckets } from '../../src/domain/practice/progress.js';
import { isEveningBreathingWindow } from '../../src/domain/practice/reminders.js';

test('напоминание 4–8 показывается с 21:00 до 22:59', () => {
  assert.equal(isEveningBreathingWindow(new Date(2026, 6, 29, 20, 59)), false);
  assert.equal(isEveningBreathingWindow(new Date(2026, 6, 29, 21, 0)), true);
  assert.equal(isEveningBreathingWindow(new Date(2026, 6, 29, 22, 59)), true);
  assert.equal(isEveningBreathingWindow(new Date(2026, 6, 29, 23, 0)), false);
});

test('когерентный протокол сохраняет выбранный темп', () => {
  const phases = phasesFor('coherent', 5.5);
  assert.ok(Math.abs(paceBpm(phases) - 5.5) < 1e-12);
  assert.ok(Math.abs(cycleSeconds(phases) - 60 / 5.5) < 1e-12);
});

test('неизвестный протокол безопасно заменяется когерентным', () => {
  const phases = phasesFor('unknown', 5.5);
  assert.equal(phases.length, 2);
  assert.equal(phases[0].label, 'Вдох');
});

test('фаза и число циклов устойчивы на границе цикла', () => {
  const phases = phasesFor('box');
  assert.equal(phaseAt(phases, 0).label, 'Вдох');
  assert.equal(phaseAt(phases, 4).label, 'Задержка');
  assert.equal(phaseAt(phases, 16).label, 'Вдох');
  assert.equal(breathCount(phases, 48.1), 3);
});

test('точные отметки циклов дают полное соответствие', () => {
  assert.equal(adherence([0, 10_000, 20_000, 30_000], 10), 1);
  assert.equal(adherence([0, 10_000], 10), null);
});

test('RMSSD считается только для валидной серии', () => {
  assert.equal(rmssd([{ ibi: 1000 }, { ibi: 1010 }]), null);
  assert.ok(Math.abs(rmssd([{ ibi: 1000 }, { ibi: 1010 }, { ibi: 990 }]) - Math.sqrt(250)) < 1e-12);
});

test('показатели пульса скрыты до достаточного числа валидных интервалов', () => {
  assert.equal(pulseSignalSummary([{ ibi: 800 }, { ibi: 810 }]).hr, null);
  const summary = pulseSignalSummary([{ ibi: 800 }, { ibi: 810 }, { ibi: 790 }, { ibi: 805 }], 'tap');
  assert.ok(summary.hr > 70 && summary.hr < 80);
  assert.ok(summary.quality > 0 && summary.quality <= 0.85);
});

test('созвучие не вычисляется по короткому сигналу', () => {
  const start = 1_000_000;
  const beats = Array.from({ length: 5 }, (_, index) => ({ t: start + index * 800, ibi: 800 }));
  assert.equal(breathingCoherence(beats, (second) => Math.sin(second), start, 0, start + 5_000), null);
});

test('заряд, серия и недельные корзины зависят только от истории', () => {
  const now = new Date(2026, 6, 22, 12, 0, 0);
  const history = [
    { date: new Date(2026, 6, 21, 9, 0, 0).toISOString(), durationMs: 10 * 60_000 },
    { date: new Date(2026, 6, 22, 9, 0, 0).toISOString(), durationMs: 20 * 60_000 },
  ];
  assert.equal(streakDays(history, now), 2);
  assert.ok(centerCharge(history, now) > 0);
  assert.equal(weekBuckets(history, now).reduce((sum, day) => sum + day.min, 0), 30);
});
