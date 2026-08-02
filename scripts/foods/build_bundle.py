"""Build the offline food catalogue from official open datasets.

The merge is intentionally conservative: source rows are joined only by an exact
normalised English name. Fuzzy matching belongs to UI search, not nutrient ETL,
because a false merge is worse than a duplicate food.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import pandas as pd

NUTRIENTS = ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sodium_mg", "potassium_mg", "magnesium_mg")
NUTRIENT_MAX = {"kcal": 1000, "protein_g": 100, "fat_g": 100, "carbs_g": 100, "fiber_g": 100, "sodium_mg": 50_000, "potassium_mg": 20_000, "magnesium_mg": 10_000}
MACRO_PRIORITY = ("usda_foundation", "ciqual", "cofid", "afcd")
MINERAL_PRIORITY = ("ciqual", "afcd", "cofid", "usda_foundation")
FIBER_PRIORITY = ("afcd", "ciqual", "cofid", "usda_foundation")
SOURCE_RANK = {code: index for index, code in enumerate(("ciqual", "usda_foundation", "cofid", "afcd"))}

RU_TERMS = (
    ("buckwheat", "гречка"), ("chicken breast", "куриная грудка"), ("chicken", "курица"),
    ("turkey", "индейка"), ("beef", "говядина"), ("pork", "свинина"), ("lamb", "баранина"),
    ("salmon", "лосось"), ("tuna", "тунец"), ("cod", "треска"), ("herring", "сельдь"),
    ("mackerel", "скумбрия"), ("shrimp", "креветки"), ("egg", "яйцо"), ("milk", "молоко"),
    ("yogurt", "йогурт"), ("yoghurt", "йогурт"), ("cottage cheese", "творог"), ("cheese", "сыр"),
    ("butter", "сливочное масло"), ("olive oil", "оливковое масло"), ("sunflower oil", "подсолнечное масло"),
    ("apple", "яблоко"), ("banana", "банан"), ("orange", "апельсин"), ("mandarin", "мандарин"),
    ("pear", "груша"), ("peach", "персик"), ("apricot", "абрикос"), ("plum", "слива"),
    ("grape", "виноград"), ("strawberry", "клубника"), ("raspberry", "малина"),
    ("blueberry", "черника"), ("blackcurrant", "чёрная смородина"), ("watermelon", "арбуз"),
    ("tomato", "помидор"), ("cucumber", "огурец"), ("potato", "картофель"), ("carrot", "морковь"),
    ("cabbage", "капуста"), ("broccoli", "брокколи"), ("cauliflower", "цветная капуста"),
    ("beet", "свёкла"), ("onion", "лук"), ("garlic", "чеснок"), ("spinach", "шпинат"),
    ("pumpkin", "тыква"), ("mushroom", "грибы"), ("avocado", "авокадо"),
    ("rice", "рис"), ("oat", "овёс"), ("millet", "пшено"), ("barley", "ячмень"),
    ("pasta", "макароны"), ("bread", "хлеб"), ("lentil", "чечевица"), ("chickpea", "нут"),
    ("bean", "фасоль"), ("pea", "горох"), ("walnut", "грецкий орех"), ("almond", "миндаль"),
    ("hazelnut", "фундук"), ("peanut", "арахис"), ("sunflower seed", "семена подсолнечника"),
    ("honey", "мёд"), ("sugar", "сахар"), ("chocolate", "шоколад"), ("coffee", "кофе"), ("tea", "чай"),
)

SOURCES = [
    {"code": "ciqual", "name": "Ciqual 2025 (ANSES)", "url": "https://ciqual.anses.fr/", "license": "Etalab Open Licence 2.0"},
    {"code": "usda_foundation", "name": "USDA FoodData Central Foundation Foods", "url": "https://fdc.nal.usda.gov/download-datasets/", "license": "Public domain (US Government)"},
    {"code": "cofid", "name": "UK CoFID 2021", "url": "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid", "license": "Open Government Licence v3.0"},
    {"code": "afcd", "name": "Australian Food Composition Database Release 3", "url": "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files", "license": "Creative Commons Attribution 3.0 Australia"},
]


def clean_number(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip().replace(",", ".")
    if not text or text.lower() in {"-", "n", "nan", "nd", "not detected"}:
        return None
    if text.lower() in {"tr", "trace"}:
        return 0.01
    text = re.sub(r"^[<>≤≥]\s*", "", text)
    try:
        result = float(text)
        return result if math.isfinite(result) and result >= 0 else None
    except ValueError:
        return None


def normalise_name(name):
    text = str(name or "").lower().replace("\n", " ")
    text = re.sub(r"\([^)]*\)", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def russian_name(name):
    lower = str(name).lower()
    for term, translated in RU_TERMS:
        if re.search(rf"\b{re.escape(term)}s?\b", lower):
            qualifiers = []
            for en, ru in (("raw", "сырой"), ("cooked", "приготовленный"), ("boiled", "варёный"), ("roasted", "запечённый"), ("dried", "сушёный"), ("canned", "консервированный"), ("frozen", "замороженный")):
                if en in lower:
                    qualifiers.append(ru)
            return translated.capitalize() + (", " + ", ".join(qualifiers) if qualifiers else "")
    return None


def find_col(frame, *needles):
    wanted = [needle.lower() for needle in needles]
    for column in frame.columns:
        flat = re.sub(r"\s+", " ", str(column).lower().replace("\n", " ")).strip()
        if all(needle in flat for needle in wanted):
            return column
    return None


def record(source, source_id, name, category, values, method):
    cleaned = {key: clean_number(values.get(key)) for key in NUTRIENTS}
    cleaned = {key: value if value is None or value <= NUTRIENT_MAX[key] else None for key, value in cleaned.items()}
    if not any(value is not None for value in cleaned.values()):
        return None
    return {"source": source, "source_id": str(source_id), "name": str(name).strip(), "category": str(category or "").strip(), "values": cleaned, "method": method}


def parse_ciqual(path):
    df = pd.read_excel(path, sheet_name="food composition", dtype=object)
    cols = {
        "kcal": find_col(df, "regulation", "kcal"), "protein_g": find_col(df, "protein", "g 100g"),
        "fat_g": find_col(df, "fat", "g 100g"), "carbs_g": find_col(df, "carbohydrate", "g 100g"),
        "fiber_g": find_col(df, "fibres", "g 100g"), "sodium_mg": find_col(df, "sodium", "mg 100g"),
        "potassium_mg": find_col(df, "potassium", "mg 100g"), "magnesium_mg": find_col(df, "magnesium", "mg 100g"),
    }
    rows = []
    for _, row in df.iterrows():
        item = record("ciqual", row.get("alim_code"), row.get("alim_nom_eng"), row.get("alim_grp_nom_eng"), {key: row.get(column) if column else None for key, column in cols.items()}, "official_reference")
        if item and item["name"] not in {"", "nan"}: rows.append(item)
    return rows


def parse_usda(path):
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    foods = raw.get("FoundationFoods") or raw.get("foods") or []
    nutrient_ids = {1008: "kcal", 1003: "protein_g", 1004: "fat_g", 1005: "carbs_g", 1079: "fiber_g", 1093: "sodium_mg", 1092: "potassium_mg", 1090: "magnesium_mg"}
    rows = []
    for food in foods:
        if not isinstance(food, dict):
            continue
        values = {}
        for entry in food.get("foodNutrients", []):
            nutrient = entry.get("nutrient") or {}
            key = nutrient_ids.get(int(nutrient.get("id") or 0))
            points = entry.get("dataPoints")
            if key and (points is None or clean_number(points) not in (None, 0)):
                values[key] = entry.get("amount")
        category = food.get("foodCategory") or {}
        category_name = category.get("description") if isinstance(category, dict) else str(category)
        item = record("usda_foundation", food.get("fdcId"), food.get("description"), category_name, values, "analytical")
        if item: rows.append(item)
    return rows


def parse_cofid(path):
    prox = pd.read_excel(path, sheet_name="1.3 Proximates", dtype=object).iloc[2:].copy()
    minerals = pd.read_excel(path, sheet_name="1.4 Inorganics", dtype=object).iloc[2:].copy()
    mineral_code = minerals.columns[0]
    mineral_by_code = {str(row.get(mineral_code)).strip(): row for _, row in minerals.iterrows() if clean_number(row.get(mineral_code)) is not None or str(row.get(mineral_code)).strip() not in {"", "nan"}}
    cols = {
        "kcal": find_col(prox, "energy", "kcal"), "protein_g": find_col(prox, "protein"), "fat_g": find_col(prox, "fat"),
        "carbs_g": find_col(prox, "carbohydrate"), "fiber_g": find_col(prox, "aoac fibre"),
        "sodium_mg": find_col(minerals, "sodium", "mg"), "potassium_mg": find_col(minerals, "potassium", "mg"), "magnesium_mg": find_col(minerals, "magnesium", "mg"),
    }
    rows = []
    for _, row in prox.iterrows():
        code = str(row.get("Food Code")).strip()
        mrow = mineral_by_code.get(code, {})
        values = {key: (mrow.get(column) if key.endswith("_mg") else row.get(column)) if column else None for key, column in cols.items()}
        item = record("cofid", code, row.get("Food Name"), row.get("Group"), values, "official_reference")
        if item and item["name"] not in {"", "nan"}: rows.append(item)
    return rows


def parse_afcd(path):
    df = pd.read_excel(path, sheet_name="All solids & liquids per 100 g", header=2, dtype=object)
    cols = {
        "protein_g": find_col(df, "protein", "g"), "fat_g": find_col(df, "total fat", "g"),
        "carbs_g": find_col(df, "available carbohydrate", "without sugar alcohols"), "fiber_g": find_col(df, "total dietary fibre"),
        "sodium_mg": find_col(df, "sodium", "mg"), "potassium_mg": find_col(df, "potassium", "mg"), "magnesium_mg": find_col(df, "magnesium", "mg"),
    }
    energy_kj = find_col(df, "energy", "kj")
    rows = []
    for _, row in df.iterrows():
        if str(row.get("Derivation", "")).strip().lower() != "analysed":
            continue
        values = {key: row.get(column) if column else None for key, column in cols.items()}
        kj = clean_number(row.get(energy_kj)) if energy_kj else None
        values["kcal"] = round(kj / 4.184, 3) if kj is not None else None
        item = record("afcd", row.get("Public Food Key"), row.get("Food Name"), row.get("Classification Code"), values, "analytical")
        if item: rows.append(item)
    return rows


def priority_for(nutrient):
    if nutrient in {"sodium_mg", "potassium_mg", "magnesium_mg"}: return MINERAL_PRIORITY
    if nutrient == "fiber_g": return FIBER_PRIORITY
    return MACRO_PRIORITY


def merge(rows):
    groups = {}
    for row in rows:
        key = normalise_name(row["name"])
        if key: groups.setdefault(key, []).append(row)
    output = []
    for key, candidates in groups.items():
        display = sorted(candidates, key=lambda item: SOURCE_RANK[item["source"]])[0]
        per100g = {}
        for nutrient in NUTRIENTS:
            chosen = next((item for source in priority_for(nutrient) for item in candidates if item["source"] == source and item["values"].get(nutrient) is not None), None)
            if chosen:
                per100g[nutrient] = round(chosen["values"][nutrient], 3)
                per100g[f"{nutrient}_src"] = chosen["source"]
                per100g[f"{nutrient}_source_id"] = chosen["source_id"]
                per100g[f"{nutrient}_method"] = "calculated_from_kj" if chosen["source"] == "afcd" and nutrient == "kcal" else chosen["method"]
        name_ru = russian_name(display["name"])
        output.append({
            "id": "food-" + hashlib.sha1(key.encode()).hexdigest()[:12], "name_ru": name_ru,
            "name_en": display["name"], "category": display["category"], "per100g": per100g,
            "portion_hints": portion_hints(display["name"]),
        })
    return output


def portion_hints(name):
    lower = name.lower()
    if "egg" in lower: return [{"label": "1 шт.", "grams": 55}, {"label": "2 шт.", "grams": 110}]
    if any(word in lower for word in ("apple", "orange", "pear", "banana")): return [{"label": "1 шт.", "grams": 150}]
    if "bread" in lower: return [{"label": "1 ломтик", "grams": 30}]
    return [{"label": "малая порция", "grams": 100}, {"label": "порция", "grams": 200}]


def select_bundle(foods, limit):
    def score(food):
        complete = sum(food["per100g"].get(key) is not None for key in NUTRIENTS)
        common = 20 if food.get("name_ru") else 0
        return common + complete
    return sorted(foods, key=lambda food: (-score(food), food.get("name_ru") is None, food["name_en"]))[:limit]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ciqual", type=Path, required=True)
    parser.add_argument("--usda", type=Path, required=True)
    parser.add_argument("--cofid", type=Path, required=True)
    parser.add_argument("--afcd", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=2000)
    args = parser.parse_args()
    source_rows = parse_ciqual(args.ciqual) + parse_usda(args.usda) + parse_cofid(args.cofid) + parse_afcd(args.afcd)
    foods = merge(source_rows)
    selected = select_bundle(foods, max(100, args.limit))
    bundle = {"schema_version": 1, "generated_from": SOURCES, "foods": selected, "stats": {"source_rows": len(source_rows), "canonical_foods": len(foods), "bundled_foods": len(selected)}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(bundle["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
