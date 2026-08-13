# Офлайн-каталог продуктов

Два независимых способа собрать один и тот же `src/data/foods-core.json` —
выбор зависит от того, в каком виде есть исходные данные.

## Вариант A — из первичных выгрузок (`build_bundle.py`)

Читает официальные выгрузки Ciqual, USDA FoodData Central Foundation Foods,
CoFID и AFCD в их родном формате (XLSX/JSON).

```powershell
C:\Users\Sasha\AppData\Local\Python\bin\python.exe scripts\foods\build_bundle.py `
  --ciqual C:\tmp\svoya-nota-tables-20260802\ciqual.xlsx `
  --usda C:\tmp\svoya-nota-tables-20260802\usda\FoodData_Central_foundation_food_json_2026-04-30.json `
  --cofid C:\tmp\svoya-nota-tables-20260802\cofid.xlsx `
  --afcd C:\tmp\svoya-nota-tables-20260802\afcd-profiles.xlsx `
  --output src\data\foods-core.json --limit 2000
```

## Вариант B — из сводного markdown-каталога (`build_bundle_from_catalog_md.py`)

Когда прямой сети к ciqual.anses.fr / fdc.nal.usda.gov / gov.uk /
foodstandards.gov.au нет (например, из-за политики egress окружения-агента),
источником служит один markdown-файл с уже выгруженными таблицами четырёх
баз (по одной pipe-таблице на источник, 15 колонок: Продукт, Источник, ID,
Категория, Энергия, Белки, Жиры, Углеводы, Клетчатка, Na, K, Mg, Ca, P, Cl).
Ca/P/Cl принимаются на вход, но не попадают в бандл — в текущей модели
приложения этих нутриентов нет.

Так собран текущий `foods-core.json` (2026-08-13): вход — предоставленный
пользователем каталог **Ciqual 2020 (ANSES)**, **USDA SR28** (National
Nutrient Database for Standard Reference, Release 28 — не Foundation
Foods), **CoFID 2021** и **AFCD Release 3**, суммарно 16 449 исходных строк
→ 16 094 канонических продукта после слияния по точному названию, все
включены в бандл (`--limit` не задавался).

```bash
python3 scripts/foods/build_bundle_from_catalog_md.py \
  --input /path/to/Catalog_Ciqual_USDA_CoFID_AFCD_full.md \
  --output src/data/foods-core.json
# --limit N — если нужно ограничить размер вместо «всё, что есть»
```

Раз в этом варианте USDA — SR28, а не Foundation Foods, построчного признака
лабораторного data-point у него, как и у остальных трёх источников, нет;
поэтому все четыре источника здесь маркируются `official_reference`
(вариант A даёт USDA `analytical`, потому что там есть точки данных из
самого JSON FDC).

## Общие принципы (для обоих вариантов)

- никаких данных Скурихина—Тутельяна и других закрытых таблиц;
- слияние продуктов только по точному нормализованному английскому названию — нечёткое объединение может смешать разные продукты;
- выбор источника выполняется для каждого нутриента отдельно;
- `N`, `—`, прочерки и отсутствующие значения остаются `null`, а не превращаются в нули; `traces`/`trace` — условно 0.01;
- CoFID Na/K/Mg уже указаны в мг/100 г и не умножаются на 1000;
- вариант A: AFCD включает только строки `Derivation = Analysed`, USDA — значения с лабораторными точками данных; вариант B не может этого проверить (см. выше) и маркирует всё как `official_reference`;
- `russian_name()` ищет термин в названии в обоих порядках слов ("cottage cheese" и "Cheese, cottage") — иначе частая для USDA/Ciqual инверсия ("Oil, olive", "Cheese, cottage") оставляет продукт без русского имени.

Исходные XLSX/JSON/markdown не коммитятся и не попадают в `dist`; в приложение входит только сжатый JSON и обязательная атрибуция. Каталог грузится приложением отдельным чанком (`src/infrastructure/foodCatalogLoader.js`) через динамический `import()`, а не при первом рендере — иначе десятки тысяч продуктов задержали бы первую отрисовку.
