import assert from 'node:assert/strict';
import test from 'node:test';

import {
  latestState, openingState, representativeStateValues, STATE_PHASE, statePayload,
} from '../../src/domain/stateCheckIn.js';

const entry = (at, phase, values) => ({
  at,
  payload: { phase, calm: 3, energy: 3, clarity: 3, warmth: 3, ...values },
});

test('новая отметка состояния нормализует шкалы и явный тип', () => {
  assert.deepEqual(statePayload(
    { calm: 0, energy: 2.6, clarity: 9, warmth: '4' },
    STATE_PHASE.MOMENT,
  ), { calm: 1, energy: 3, clarity: 5, warmth: 4, phase: 'moment' });
});

test('старые утренние и вечерние отметки читаются без миграции журнала', () => {
  const morning = entry('2026-07-28T08:00:00Z', 'morning', { energy: 2 });
  const evening = entry('2026-07-28T20:00:00Z', 'evening', { energy: 4 });
  const states = [evening, morning];

  assert.equal(openingState(states), morning);
  assert.equal(latestState(states, STATE_PHASE.DAY_SUMMARY), evening);
});

test('итог дня имеет приоритет над частыми моментальными замерами', () => {
  const states = [
    entry('2026-07-28T09:00:00Z', 'moment', { calm: 1, energy: 1, clarity: 1, warmth: 1 }),
    entry('2026-07-28T12:00:00Z', 'moment', { calm: 2, energy: 2, clarity: 2, warmth: 2 }),
    entry('2026-07-28T21:00:00Z', 'day-summary', { calm: 4, energy: 4, clarity: 4, warmth: 4 }),
  ];

  assert.deepEqual(representativeStateValues(states), [4, 4, 4, 4]);
});

test('без итога аналитика усредняет каждый показатель между моментами', () => {
  const states = [
    entry('2026-07-28T09:00:00Z', 'moment', { calm: 1, energy: 2 }),
    entry('2026-07-28T12:00:00Z', 'moment', { calm: 5, energy: 4 }),
  ];

  assert.deepEqual(representativeStateValues(states), [3, 3, 3, 3]);
});
