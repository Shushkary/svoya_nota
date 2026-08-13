const round1 = (value) => Math.round(value * 10) / 10;

const SOURCE_LABELS = Object.freeze({
  ciqual: 'Ciqual (ANSES)',
  usda_foundation: 'USDA Foundation',
  usda_sr28: 'USDA SR28',
  cofid: 'UK CoFID',
  afcd: 'AFCD R3',
  manual: 'Введено вручную',
});

export function sourceLabel(code) {
  return SOURCE_LABELS[code] || String(code || 'источник не указан');
}

export function normalizeFoodQuery(value) {
  return String(value || '').toLowerCase().trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

const tokens = (value) => normalizeFoodQuery(value).split(/[^a-zа-я0-9]+/i).filter(Boolean);

function distance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function searchFoods(foods, query, maxResults = 12) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  return (foods || []).map((food) => {
    const foodTokens = tokens(`${food.name_ru || ''} ${food.name_en || ''}`);
    const score = queryTokens.reduce((total, queryToken) => total + foodTokens.reduce((best, foodToken) => {
      if (foodToken === queryToken) return Math.max(best, 3);
      if (foodToken.startsWith(queryToken) || queryToken.startsWith(foodToken)) return Math.max(best, 2);
      if (queryToken.length >= 3 && foodToken.includes(queryToken)) return Math.max(best, 1.5);
      if (queryToken.length >= 3 && Math.abs(foodToken.length - queryToken.length) <= 1 && distance(foodToken, queryToken) <= 1) return Math.max(best, 1);
      return best;
    }, 0), 0);
    return { food, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.food.name_ru)) - Number(Boolean(a.food.name_ru)))
    .slice(0, Math.max(1, maxResults)).map(({ food }) => food);
}

export function scaleFoodPortion(food, portionG) {
  const grams = Math.max(1, Math.min(5000, Number(portionG) || 100));
  const factor = grams / 100;
  const p = food?.per100g || {};
  const scale = (key) => p[key] == null ? null : round1(Number(p[key]) * factor);
  const provenance = {};
  for (const key of ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sodium_mg', 'potassium_mg', 'magnesium_mg']) {
    if (p[key] != null && p[`${key}_src`]) provenance[key] = p[`${key}_src`];
  }
  return {
    portionG: round1(grams), kcal: scale('kcal'), proteinG: scale('protein_g'),
    fatG: scale('fat_g'), carbG: scale('carbs_g'), fiberG: scale('fiber_g'),
    sodiumMg: scale('sodium_mg'), potassiumMg: scale('potassium_mg'), magnesiumMg: scale('magnesium_mg'),
    provenance,
  };
}

export function foodComponent(food, portionG) {
  return { foodId: food.id, foodName: food.name_ru || food.name_en, ...scaleFoodPortion(food, portionG) };
}

export function sumFoodComponents(components) {
  const sum = (key) => round1((components || []).reduce((total, item) => total + (Number(item[key]) || 0), 0));
  return {
    kcal: sum('kcal'), proteinG: sum('proteinG'), fatG: sum('fatG'), carbG: sum('carbG'), fiberG: sum('fiberG'),
    sodiumMg: sum('sodiumMg'), potassiumMg: sum('potassiumMg'), magnesiumMg: sum('magnesiumMg'),
  };
}
