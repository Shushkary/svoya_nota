import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateMeals,
  clampMealTimestamp,
  combinedDigestiveLoad,
  digestionActivityAt,
  digestionFinishesBy,
  digestiveLoad,
  effectiveDigestionHours,
  estimateDigestionHours,
  estimateProcessing,
  mealDigestionShift,
  mealTimestamp,
  nutrientProgress,
  normalizeMeal,
  scaleMealPayload,
} from '../../src/domain/nutrition/meal.js';
import { formatHour, hourToAngle, mealType } from '../../src/domain/nutrition/rhythm.js';
import {
  ACTIVITY_MET,
  dailyActivityExpenditure,
  estimateActivityCalories,
  estimateStepCalories,
  findFreeActivityStart,
} from '../../src/domain/nutrition/activity.js';
import { canonicalStepsForDay, stepsActivity } from '../../src/domain/nutrition/steps.js';
import { weekSummary } from '../../src/domain/loop.js';

test('домашняя яичница не определяется как ультрапереработанная еда', () => {
  const processing = estimateProcessing('яичница из 3 яиц на топлёном масле с зеленью', 0.92);
  assert.equal(processing.pos, 0.2);
  assert.equal(processing.cf, 'средняя');
});

test('пищеварительная нагрузка зависит от состава, а не от NOVA-класса', () => {
  const light = { kcal: 160, p: 10, f: 4, c: 20, fiber: 4 };
  const dense = { kcal: 760, p: 45, f: 38, c: 80, fiber: 10 };
  assert.ok(digestiveLoad(dense) > digestiveLoad(light));
  assert.ok(estimateDigestionHours(dense) > estimateDigestionHours(light));
});

test('нагрузка плавно затухает и не остаётся после окна переваривания', () => {
  const eatenAt = new Date(2026, 6, 22, 12, 0, 0).getTime();
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt, digestionH: 3 };
  assert.equal(digestionActivityAt(meal, new Date(2026, 6, 22, 12, 10, 0)), 1);
  assert.ok(digestionActivityAt(meal, new Date(2026, 6, 22, 14, 0, 0)) < 1);
  assert.equal(digestionActivityAt(meal, new Date(2026, 6, 22, 15, 1, 0)), 0);
});

test('будущий приём не отображается на тороиде и не создаёт нагрузку', () => {
  const now = new Date(2026, 7, 2, 12, 43, 0);
  const meal = {
    kcal: 250, p: 12, f: 20, c: 2, fiber: 0,
    eatenAt: new Date(2026, 7, 2, 17, 18, 0).getTime(),
    digestionH: 3,
  };
  assert.equal(digestionActivityAt(meal, now), 0);
  assert.equal(combinedDigestiveLoad([meal], now), 0);
});

test('время фактического приёма ограничивается текущим', () => {
  const now = new Date(2026, 7, 2, 12, 43, 0);
  const past = new Date(2026, 7, 2, 10, 15, 0);
  const future = new Date(2026, 7, 2, 17, 18, 0);
  assert.equal(clampMealTimestamp(past, now), past.getTime());
  assert.equal(clampMealTimestamp(future, now), now.getTime());
});

test('жёлтая сетка определяется окончанием переваривания к 18:00', () => {
  assert.equal(digestionFinishesBy(14, 4), true, 'ровно к 18:00 — жёлтая');
  assert.equal(digestionFinishesBy(14, 4.01), false, 'после 18:00 — предупреждающая');
  assert.equal(digestionFinishesBy(17, 0.5), true);
  assert.equal(digestionFinishesBy(23, 2), false, 'переход через полночь не считается ранним');
});

test('несколько активных приёмов объединяются без выхода за диапазон 0..1', () => {
  const now = new Date(2026, 6, 22, 14, 0, 0);
  const base = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt: now.getTime(), digestionH: 3 };
  const one = combinedDigestiveLoad([base], now);
  const two = combinedDigestiveLoad([base, { ...base }], now);
  assert.ok(one > 0 && one <= 1);
  assert.ok(two > one && two <= 1);
});

test('приём 23:30 после полуночи относится к предыдущему вечеру', () => {
  const now = new Date(2026, 6, 23, 0, 30, 0);
  const timestamp = new Date(mealTimestamp(23.5, now));
  assert.equal(timestamp.getDate(), 22);
  assert.equal(timestamp.getHours(), 23);
  assert.equal(timestamp.getMinutes(), 30);
});

test('некорректные числовые поля нормализуются на доменной границе', () => {
  const meal = normalizeMeal({ name: '  суп  ', kcal: 'x', p: -5, f: 12, c: 20 });
  assert.equal(meal.name, 'суп');
  assert.equal(meal.kcal, 0);
  assert.equal(meal.p, 0);
  assert.equal(aggregateMeals([meal, { kcal: 100, p: 3 }]).kcal, 100);
});

test('повтор блюда масштабирует порцию и пересчитывает пищеварительную оценку', () => {
  const original = {
    description: 'Гречка с курицей',
    kcal: 420, proteinG: 32, fatG: 11, carbG: 49, fiberG: 6,
    sodiumMg: 300, potassiumMg: 500, magnesiumMg: 80, digestionH: 2,
  };
  const repeated = scaleMealPayload(original, 1.5);

  assert.equal(repeated.kcal, 630);
  assert.equal(repeated.proteinG, 48);
  assert.equal(repeated.fatG, 16.5);
  assert.equal(repeated.repeatPortionFactor, 1.5);
  assert.ok(repeated.digestionH > original.digestionH);
  assert.equal(original.kcal, 420, 'исходная запись не изменяется');
});

test('масштаб повторной порции ограничен безопасным диапазоном интерфейса', () => {
  assert.equal(scaleMealPayload({ kcal: 100 }, 0).kcal, 25);
  assert.equal(scaleMealPayload({ kcal: 100 }, 99).kcal, 300);
});

test('минералы суммируются один раз и сохраняют миллиграммы', () => {
  const total = aggregateMeals([
    { sodium: 500, potassium: 608, magnesium: 200 },
    { sodium: 320, potassium: 450, magnesium: 75 },
  ]);
  assert.equal(total.sodium, 820);
  assert.equal(total.potassium, 1058);
  assert.equal(total.magnesium, 275);
});

test('кольцо показывает фактический процент выше 100, но не рисует больше круга', () => {
  assert.deepEqual(nutrientProgress(2500, 2000), { ratio: 1, percent: 125 });
  assert.deepEqual(nutrientProgress(1755, 3510), { ratio: 0.5, percent: 50 });
  assert.deepEqual(nutrientProgress(-10, 2000), { ratio: 0, percent: 0 });
});

test('правила времени едины для журнала и будущего React-виджета', () => {
  assert.equal(formatHour(25.5), '01:30');
  assert.equal(mealType(10.99), 'завтрак');
  assert.equal(mealType(16), 'перекус');
  assert.equal(mealType(18), 'ужин');
  assert.ok(Math.abs(hourToAngle(6) - Math.PI / 2) < 1e-12);
});

// Оценка активности намеренно не зависит от веса: вес относится к специальной
// категории ПДн (ФЗ-152) и приложением не собирается — см. ProfileCard.
test('оценка активности считается без веса и не накладывается по времени', () => {
  // MET × часы, без множителя массы тела
  assert.equal(estimateActivityCalories('run', 30), 5); // 9.8 × 0.5 ч
  assert.equal(estimateActivityCalories('walk_brisk', 40), 3); // 3.8 × 40/60
  // Неизвестный тип активности не роняет расчёт — берётся спокойная ходьба.
  assert.equal(estimateActivityCalories('нет такого', 60), Math.round(ACTIVITY_MET.walk_brisk));
  // Шаги: длина шага от роста, вес не участвует
  assert.equal(estimateStepCalories(10_000, 175), 363);
  assert.equal(findFreeActivityStart([{ startMin: 780, durationMin: 60 }], 800, 30), 840);
});

test('оценка активности не принимает вес как параметр', () => {
  // Защита от возврата прежней сигнатуры (type, weight, duration): третий
  // аргумент должен игнорироваться, а второй — оставаться длительностью.
  assert.equal(estimateActivityCalories('run', 30, 70), estimateActivityCalories('run', 30));
  assert.equal(estimateStepCalories(10_000, 175, 70), estimateStepCalories(10_000, 175));
});

test('шаги телефона дают одну условную активность без ложного времени', () => {
  const activity = stepsActivity(8_000, 175, 'Health Connect');
  assert.equal(activity.kcal, estimateStepCalories(8_000, 175));
  assert.equal(activity.estimatedTiming, true);
  assert.equal(activity.dailySteps, true);
  assert.equal(activity.durationMin, 80);
  assert.equal(canonicalStepsForDay('2026-07-29', {
    '2026-07-29': { steps: 8_000, source: 'Health Connect' },
  }, [{ payload: { steps: 3_000, source: 'manual' } }]).steps, 8_000,
  'локальный источник должен иметь приоритет, чтобы шаги не учитывались дважды');
});

test('недельный поток берёт локальные шаги телефона без записи в журнал', () => {
  const empty = { state: [], practice: [], meal: [], will: [], activity: [] };
  const now = new Date(2026, 6, 29, 12, 0, 0);
  const summary = weekSummary(empty, now, { '2026-07-29': { steps: 8_000, source: 'Health Connect' } });
  assert.equal(summary.flow, 1);
});

test('пересекающиеся активности не задваивают расход', () => {
  const expenditure = dailyActivityExpenditure([
    { startMin: 600, durationMin: 60, kcal: 300 },
    { startMin: 630, durationMin: 60, kcal: 180 },
  ]);
  assert.equal(expenditure, 390);
});

test('лёгкая активность рядом с приёмом сокращает окно переваривания', () => {
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt: new Date(2026, 6, 22, 12, 0, 0).getTime() };
  const base = effectiveDigestionHours(meal, []);
  const walk = effectiveDigestionHours(meal, [{ payload: { type: 'walk_brisk', startMin: 750, durationMin: 30, intensity: 'moderate' } }]);
  assert.ok(walk < base, `прогулка (${walk}) должна сокращать окно (${base})`);
  assert.ok(mealDigestionShift(meal, [{ payload: { type: 'walk_brisk', startMin: 750, durationMin: 30, intensity: 'moderate' } }]) < 0);
});

test('интенсивное плавание и баня рядом с приёмом удлиняют окно переваривания', () => {
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt: new Date(2026, 6, 22, 12, 0, 0).getTime() };
  const base = effectiveDigestionHours(meal, []);
  const swim = effectiveDigestionHours(meal, [{ payload: { type: 'swim', startMin: 750, durationMin: 30, intensity: 'high' } }]);
  const banya = effectiveDigestionHours(meal, [{ payload: { type: 'banya', startMin: 750, durationMin: 60, intensity: 'moderate' } }]);
  assert.ok(swim > base, `плавание (${swim}) должно удлинять окно (${base})`);
  assert.ok(banya > base, `баня (${banya}) должна удлинять окно (${base})`);
});

test('активность далеко от приёма не влияет на окно переваривания', () => {
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt: new Date(2026, 6, 22, 12, 0, 0).getTime() };
  const base = effectiveDigestionHours(meal, []);
  const far = effectiveDigestionHours(meal, [{ payload: { type: 'swim', startMin: 1000, durationMin: 30, intensity: 'high' } }]);
  assert.equal(far, base);
});

test('активность учитывается во всём окне переваривания, а не только в первый час', () => {
  const eatenAt = new Date(2026, 6, 22, 12, 0, 0).getTime();
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt, digestionH: 4 };
  const laterWalk = [{ payload: { type: 'walk_low', startMin: 14 * 60, durationMin: 30, intensity: 'low' } }];
  const laterRun = [{ payload: { type: 'run', startMin: 14 * 60, durationMin: 30, intensity: 'high' } }];
  const now = new Date(2026, 6, 22, 14, 30, 0);
  const restFraction = digestionActivityAt(meal, now, effectiveDigestionHours(meal, []));
  const walkFraction = digestionActivityAt(meal, now, effectiveDigestionHours(meal, laterWalk));
  const runFraction = digestionActivityAt(meal, now, effectiveDigestionHours(meal, laterRun));

  assert.ok(walkFraction < restFraction, 'прогулка внутри окна должна ускорять затухание точек');
  assert.ok(runFraction > restFraction, 'интенсивная активность внутри окна должна замедлять затухание модели');
});

test('нагрузка на тороиде учитывает активность: плавание > покой > прогулка', () => {
  const now = new Date(2026, 6, 22, 15, 0, 0);
  const meal = { kcal: 500, p: 25, f: 20, c: 45, fiber: 5, eatenAt: new Date(2026, 6, 22, 12, 0, 0).getTime() };
  const none = combinedDigestiveLoad([meal], now, []);
  const walk = combinedDigestiveLoad([meal], now, [{ payload: { type: 'walk_brisk', startMin: 750, durationMin: 30, intensity: 'moderate' } }]);
  const swim = combinedDigestiveLoad([meal], now, [{ payload: { type: 'swim', startMin: 750, durationMin: 30, intensity: 'high' } }]);
  assert.ok(swim > none, 'плавание должно повышать нагрузку');
  assert.ok(none > walk, 'прогулка должна снижать нагрузку');
});
