# Офлайн-каталог продуктов

`build_bundle.py` читает полные официальные выгрузки Ciqual 2025, USDA Foundation Foods, CoFID 2021 и AFCD R3, затем создаёт компактный `src/data/foods-core.json`.

Принципы:

- никаких данных Скурихина—Тутельяна и других закрытых таблиц;
- слияние продуктов только по точному нормализованному английскому названию — нечёткое объединение может смешать разные продукты;
- выбор источника выполняется для каждого нутриента отдельно;
- `N`, прочерки и отсутствующие значения остаются `null`, а не превращаются в нули;
- CoFID Na/K/Mg уже указаны в мг/100 г и не умножаются на 1000;
- AFCD включает только строки `Derivation = Analysed`; USDA — значения с лабораторными точками данных;
- Ciqual/CoFID маркируются как `official_reference`, потому что их сводные файлы не дают честного построчного признака лабораторного метода.

Пример запуска:

```powershell
C:\Users\Sasha\AppData\Local\Python\bin\python.exe scripts\foods\build_bundle.py `
  --ciqual C:\tmp\svoya-nota-tables-20260802\ciqual.xlsx `
  --usda C:\tmp\svoya-nota-tables-20260802\usda\FoodData_Central_foundation_food_json_2026-04-30.json `
  --cofid C:\tmp\svoya-nota-tables-20260802\cofid.xlsx `
  --afcd C:\tmp\svoya-nota-tables-20260802\afcd-profiles.xlsx `
  --output src\data\foods-core.json --limit 2000
```

Исходные XLSX/JSON не коммитятся и не попадают в `dist`; в приложение входит только сжатый JSON и обязательная атрибуция.
