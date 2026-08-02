import assert from 'node:assert/strict';
import test from 'node:test';

import { journalHypotheses } from '../../src/domain/insights.js';

function buildJournal(days, { withSleep = true } = {}) {
  const state = [];
  const activity = [];
  const practice = [];
  for (let index = 0; index < days; index += 1) {
    const day = String(index + 1).padStart(2, '0');
    const score = 1 + (index % 5);
    state.push({
      at: `2026-07-${day}T20:00:00`,
      payload: {
        phase: 'day-summary',
        calm: score, energy: score, clarity: score, warmth: score,
      },
    });
    if (withSleep) {
      activity.push({
        at: `2026-07-${day}T12:00:00`,
        payload: { date: `2026-07-${day}`, sleepHours: score + 4 },
      });
    }
    for (let count = 0; count < score; count += 1) {
      practice.push({
        at: `2026-07-${day}T10:${String(count).padStart(2, '0')}:00`,
        payload: { completed: true },
      });
    }
  }
  return { state, activity, practice };
}

test('гипотеза показывает окно, лаг, размер выборки и направление', () => {
  const result = journalHypotheses(
    buildJournal(10),
    10,
    new Date(2026, 6, 10, 22, 0, 0),
  );
  const sleep = result.observations[0];

  assert.equal(result.from, '2026-07-01');
  assert.equal(result.to, '2026-07-10');
  assert.equal(sleep.pairs, 10);
  assert.equal(sleep.lagDays, 0);
  assert.equal(sleep.status, 'hypothesis');
  assert.ok(sleep.correlation > 0.99);
});

test('маленькая выборка не превращается в вывод', () => {
  const result = journalHypotheses(
    buildJournal(4),
    4,
    new Date(2026, 6, 4, 22, 0, 0),
  );

  assert.equal(result.observations[0].status, 'insufficient');
  assert.equal(result.observations[0].pairs, 4);
  assert.match(result.observations[0].text, /ещё 3/);
});
