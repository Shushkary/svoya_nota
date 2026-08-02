import test from 'node:test';
import assert from 'node:assert/strict';
import { foodComponent, scaleFoodPortion, searchFoods, sumFoodComponents } from '../../src/domain/nutrition/foodCatalog.js';

const apple = {
  id: 'ciqual:apple', name_ru: 'Яблоко', name_en: 'Apple, raw',
  per100g: {
    kcal: 52, kcal_src: 'ciqual', protein_g: 0.3, protein_g_src: 'ciqual',
    fiber_g: 2.4, fiber_g_src: 'afcd', sodium_mg: 1, sodium_mg_src: 'ciqual',
    potassium_mg: 107, potassium_mg_src: 'ciqual', magnesium_mg: 5, magnesium_mg_src: 'ciqual',
  },
};

test('food search supports Russian prefix and a one-letter typo', () => {
  assert.equal(searchFoods([apple], 'ябл')[0].id, apple.id);
  assert.equal(searchFoods([apple], 'яблоко')[0].id, apple.id);
});

test('portion scaling keeps per-nutrient provenance', () => {
  const portion = scaleFoodPortion(apple, 150);
  assert.equal(portion.kcal, 78);
  assert.equal(portion.fiberG, 3.6);
  assert.equal(portion.potassiumMg, 160.5);
  assert.equal(portion.provenance.fiber_g, 'afcd');
});

test('components sum without converting milligrams a second time', () => {
  const first = foodComponent(apple, 100);
  const total = sumFoodComponents([first, first]);
  assert.equal(total.sodiumMg, 2);
  assert.equal(total.potassiumMg, 214);
});
