import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNutritionTargets, estimateReferenceMass } from '../../src/domain/nutrition/targets.js';

test('расчётная масса исключает оценённую жировую долю, когда есть талия', () => {
  const result = estimateReferenceMass({ weightKg: 90, heightCm: 180, waistCm: 90, sex: 'm' });
  assert.equal(result.method, 'rfm');
  assert.equal(result.bodyFatPercent, 24);
  assert.equal(result.kg, 68.4);
});

test('без талии жир не считается белковой массой: используется запасная оценка Boer', () => {
  const result = estimateReferenceMass({ weightKg: 90, heightCm: 180, sex: 'm' });
  assert.equal(result.method, 'boer');
  assert.equal(result.kg, 65.5);
  assert.equal(result.bodyFatPercent, 27.2);
});

test('без профиля весь вес не используется как безжировая масса', () => {
  const result = estimateReferenceMass({ weightKg: 90 });
  assert.deepEqual(result, { kg: null, method: 'fallback', bodyFatPercent: null });
});

test('белок считается как 1,6 г на кг расчётной безжировой массы', () => {
  const targets = computeNutritionTargets({
    profile: { height: 180, age: 40, sex: 'm' }, weightKg: 90, waistCm: 90,
  });
  assert.equal(targets.protein, 109);
  assert.equal(targets.basis.rates.proteinGPerKg, 1.59);
});

test('низкоуглеводный режим меняет углеводы, жиры и ориентир натрия', () => {
  const regular = computeNutritionTargets({
    profile: { height: 180, age: 40, sex: 'm' }, weightKg: 90, waistCm: 90,
  });
  const lowCarb = computeNutritionTargets({
    profile: { height: 180, age: 40, sex: 'm' }, weightKg: 90, waistCm: 90,
    lowCarb: true, lowCarbWeek: 8,
  });
  assert.equal(lowCarb.carb, 46);
  assert.ok(lowCarb.fat > regular.fat);
  assert.equal(lowCarb.sodium, 2300);
});

test('минеральные ориентиры взрослых зависят от пола, а не линейно от массы', () => {
  const female = computeNutritionTargets({ profile: { sex: 'f', age: 35 }, weightKg: 60 });
  const male = computeNutritionTargets({ profile: { sex: 'm', age: 35 }, weightKg: 100 });
  assert.equal(female.potassium, 2600);
  assert.equal(male.potassium, 3400);
  assert.equal(female.magnesium, 320);
  assert.equal(male.magnesium, 420);
});

test('расход активности увеличивает ориентиры колец без вычитания съеденного', () => {
  const base = computeNutritionTargets({
    profile: { height: 180, age: 40, sex: 'm' }, weightKg: 90, waistCm: 90,
  });
  const active = computeNutritionTargets({
    profile: { height: 180, age: 40, sex: 'm' }, weightKg: 90, waistCm: 90,
    activityImpact: {
      energyKcal: 400, proteinG: 5, fatG: 12, carbG: 40,
      sodiumMg: 300, potassiumMg: 120, magnesiumMg: 8, sweatLitres: 0.6,
      model: 'activity-fuel-sweat-v1',
    },
  });
  assert.equal(active.kcal, base.kcal + 400);
  assert.equal(active.protein, base.protein + 5);
  assert.equal(active.fat, base.fat + 12);
  assert.equal(active.carb, base.carb + 40);
  assert.ok(active.fiber > base.fiber, 'клетчатка не расходуется, но ориентир растёт вместе с энергией');
  assert.equal(active.sodium, base.sodium + 300);
  assert.equal(active.potassium, base.potassium + 120);
  assert.equal(active.magnesium, base.magnesium + 8);
});
