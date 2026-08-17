import React, { useEffect, useMemo, useState } from 'react';
import { foodComponent, scaleFoodPortion, searchFoods, sourceLabel } from '../domain/nutrition/foodCatalog.js';
import { loadFoodCatalog } from '../infrastructure/foodCatalogLoader.js';

const SOURCES = {
  ciqual: 'https://ciqual.anses.fr/',
  usda_foundation: 'https://fdc.nal.usda.gov/download-datasets/',
  usda_sr28: 'https://fdc.nal.usda.gov/',
  cofid: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
  afcd: 'https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files',
};
const NUTRIENTS = [
  ['kcal', 'ккал'], ['proteinG', 'Б'], ['fatG', 'Ж'], ['carbG', 'У'], ['fiberG', 'клетч.'],
  ['sodiumMg', 'Na'], ['potassiumMg', 'K'], ['magnesiumMg', 'Mg'],
];

export default function FoodCatalogPicker({ onAdd }) {
  const [foods, setFoods] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [grams, setGrams] = useState('100');

  useEffect(() => {
    let alive = true;
    loadFoodCatalog().then((list) => { if (alive) setFoods(list); });
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => (foods ? searchFoods(foods, query, 8) : []), [foods, query]);
  const portion = selected ? scaleFoodPortion(selected, grams) : null;
  const sourceCodes = portion ? [...new Set(Object.values(portion.provenance))] : [];

  return (
    <section className="food-catalog" aria-label="Таблицы состава продуктов">
      <h3>Найти продукт в таблицах</h3>
      <p className="dim small">Точный пересчёт из значений на 100 г. Поиск работает без интернета.</p>
      <label className="fl">Продукт
        <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Например: яблоко или buckwheat" autoComplete="off" />
      </label>
      {query.trim() && !selected && (
        <div className="food-results" role="listbox" aria-label="Найденные продукты">
          {!foods ? <p className="dim small">Загружаю офлайн-таблицу…</p> : results.length ? results.map((food) => (
            <button type="button" role="option" key={food.id} onClick={() => { setSelected(food); setQuery(food.name_ru || food.name_en); }}>
              <b>{food.name_ru || food.name_en}</b>{food.name_ru && food.name_en ? <small>{food.name_en}</small> : null}
            </button>
          )) : <p className="dim small">Совпадений в офлайн-каталоге нет. Можно заполнить поля вручную.</p>}
        </div>
      )}
      {selected && portion && (
        <div className="food-selection">
          <label className="fl">Порция, г
            <input type="number" inputMode="decimal" min="1" max="5000" step="1" value={grams} onChange={(event) => setGrams(event.target.value)} />
          </label>
          {Array.isArray(selected.portion_hints) && selected.portion_hints.length > 0 && <div className="portion-hints">{selected.portion_hints.map((hint) => <button type="button" key={`${hint.label}-${hint.grams}`} onClick={() => setGrams(String(hint.grams))}>{hint.label} · {hint.grams} г</button>)}</div>}
          <div className="food-nutrients">{NUTRIENTS.map(([key, label]) => portion[key] == null ? null : <span key={key}><b>{portion[key]}</b> {label}{key.endsWith('Mg') ? ' мг' : key.endsWith('G') ? ' г' : ''}</span>)}</div>
          <div className="food-sources">{sourceCodes.map((code) => <a key={code} href={SOURCES[code]} target="_blank" rel="noreferrer">{sourceLabel(code)}</a>)}</div>
          <button type="button" className="n-action ghost" onClick={() => onAdd(foodComponent(selected, grams))}>Добавить продукт в блюдо</button>
        </div>
      )}
      <details className="food-attribution"><summary>Источники и точность</summary><p>Ciqual (ANSES), USDA SR28, UK CoFID и AFCD R3. Источник хранится отдельно для каждого нутриента; прочерки не заменяются нулями. Состав природных продуктов меняется, поэтому это справочные, а не лабораторные данные конкретной порции.</p></details>
    </section>
  );
}
