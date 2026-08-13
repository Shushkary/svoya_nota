"""Build the offline food catalogue from a combined markdown export.

Input: a single markdown file with four pipe-table sections (Ciqual, CoFID,
AFCD, USDA SR28), each row giving name/id/category and per-100g nutrients.
This is an alternative entry point to build_bundle.py, used when the raw
official XLSX/JSON exports are not directly reachable (e.g. no network
access to ciqual.anses.fr / fdc.nal.usda.gov / gov.uk / foodstandards.gov.au
from this environment) but a pre-extracted markdown dump of the same
official databases was supplied instead.

Merge philosophy is unchanged from build_bundle.py: exact normalised-name
matching only (no fuzzy joins), per-nutrient source priority, missing
values stay null (never coerced to zero), and every field records which
source and method produced it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

NUTRIENTS = ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sodium_mg", "potassium_mg", "magnesium_mg")
NUTRIENT_MAX = {"kcal": 1000, "protein_g": 100, "fat_g": 100, "carbs_g": 100, "fiber_g": 100, "sodium_mg": 50_000, "potassium_mg": 20_000, "magnesium_mg": 10_000}

# USDA SR28 replaces "usda_foundation" (FoodData Central Foundation Foods) as
# the USDA leg of this bundle: this markdown export does not carry FDC's
# per-datapoint analytical flags, so USDA rows here get the same
# "official_reference" method as Ciqual/CoFID/AFCD rather than "analytical".
MACRO_PRIORITY = ("usda_sr28", "ciqual", "cofid", "afcd")
MINERAL_PRIORITY = ("ciqual", "afcd", "cofid", "usda_sr28")
FIBER_PRIORITY = ("afcd", "ciqual", "cofid", "usda_sr28")
SOURCE_RANK = {code: index for index, code in enumerate(("ciqual", "usda_sr28", "cofid", "afcd"))}

SOURCES = [
    {"code": "ciqual", "name": "Ciqual 2020 (ANSES)", "url": "https://ciqual.anses.fr/", "license": "Etalab Open Licence 2.0"},
    {"code": "usda_sr28", "name": "USDA National Nutrient Database for Standard Reference, Release 28", "url": "https://fdc.nal.usda.gov/", "license": "Public domain (US Government)"},
    {"code": "cofid", "name": "UK CoFID 2021", "url": "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid", "license": "Open Government Licence v3.0"},
    {"code": "afcd", "name": "Australian Food Composition Database Release 3", "url": "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files", "license": "Creative Commons Attribution 3.0 Australia"},
]

SECTION_HEADER = re.compile(r"^## (.+?) — [\d,]+ записей\s*$")
SECTION_TO_SOURCE = {
    "Ciqual 2020": "ciqual",
    "CoFID 2021": "cofid",
    "AFCD Release 3": "afcd",
    "USDA SR28": "usda_sr28",
}

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

NULL_TOKENS = {"-", "—", "–", "n", "nan", "nd", "not detected", ""}
TRACE_TOKENS = {"tr", "trace", "traces"}


def clean_number(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", ".")
    if text.lower() in NULL_TOKENS:
        return None
    if text.lower() in TRACE_TOKENS:
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


def term_pattern(term):
    words = term.split()
    if len(words) == 1:
        return rf"\b{re.escape(term)}s?\b"
    # Официальные базы часто пишут "Cheese, cottage" вместо "cottage cheese" —
    # проверяем оба порядка слов в пределах короткого разделителя (запятая,
    # пробел), иначе "творог" и подобные распознаются лишь в части записей.
    forward = r"\b" + r"\W{1,3}".join(re.escape(word) for word in words) + r"s?\b"
    backward = r"\b" + r"\W{1,3}".join(re.escape(word) for word in reversed(words)) + r"s?\b"
    return f"(?:{forward}|{backward})"


def russian_name(name):
    lower = str(name).lower()
    for term, translated in RU_TERMS:
        if re.search(term_pattern(term), lower):
            qualifiers = []
            for en, ru in (("raw", "сырой"), ("cooked", "приготовленный"), ("boiled", "варёный"), ("roasted", "запечённый"), ("dried", "сушёный"), ("canned", "консервированный"), ("frozen", "замороженный")):
                if en in lower:
                    qualifiers.append(ru)
            return translated.capitalize() + (", " + ", ".join(qualifiers) if qualifiers else "")
    return None


def portion_hints(name):
    lower = name.lower()
    if "egg" in lower:
        return [{"label": "1 шт.", "grams": 55}, {"label": "2 шт.", "grams": 110}]
    if any(word in lower for word in ("apple", "orange", "pear", "banana")):
        return [{"label": "1 шт.", "grams": 150}]
    if "bread" in lower:
        return [{"label": "1 ломтик", "grams": 30}]
    return [{"label": "малая порция", "grams": 100}, {"label": "порция", "grams": 200}]


def split_row(line):
    # Markdown table row: leading/trailing pipe optional, cells separated by
    # unescaped "|". None of the source fields in this export contain a
    # literal pipe character, so a plain split is safe and exact.
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [cell.strip() for cell in body.split("|")]


def parse_markdown(path):
    rows = []
    current_source = None
    with open(path, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\n")
            header = SECTION_HEADER.match(line)
            if header:
                current_source = SECTION_TO_SOURCE.get(header.group(1))
                continue
            if current_source is None or not line.startswith("|"):
                continue
            if line.startswith("| ---") or line.startswith("| Продукт"):
                continue
            cells = split_row(line)
            if len(cells) < 15:
                continue
            name, _source_label, source_id, category = cells[0], cells[1], cells[2], cells[3]
            if not name or name.lower() == "nan":
                continue
            values = {
                "kcal": clean_number(cells[4]), "protein_g": clean_number(cells[5]),
                "fat_g": clean_number(cells[6]), "carbs_g": clean_number(cells[7]),
                "fiber_g": clean_number(cells[8]), "sodium_mg": clean_number(cells[9]),
                "potassium_mg": clean_number(cells[10]), "magnesium_mg": clean_number(cells[11]),
                # Ca/P/Cl (cells[12:15]) are carried by the source export but
                # unused: the app's KБЖУ/electrolyte model doesn't track them.
            }
            values = {key: value if value is None or value <= NUTRIENT_MAX[key] else None for key, value in values.items()}
            if not any(value is not None for value in values.values()):
                continue
            rows.append({
                "source": current_source, "source_id": source_id, "name": name,
                "category": category, "values": values, "method": "official_reference",
            })
    return rows


def priority_for(nutrient):
    if nutrient in {"sodium_mg", "potassium_mg", "magnesium_mg"}:
        return MINERAL_PRIORITY
    if nutrient == "fiber_g":
        return FIBER_PRIORITY
    return MACRO_PRIORITY


def merge(rows):
    groups = {}
    for row in rows:
        key = normalise_name(row["name"])
        if key:
            groups.setdefault(key, []).append(row)
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
                per100g[f"{nutrient}_method"] = chosen["method"]
        name_ru = russian_name(display["name"])
        output.append({
            "id": "food-" + hashlib.sha1(key.encode()).hexdigest()[:12], "name_ru": name_ru,
            "name_en": display["name"], "category": display["category"], "per100g": per100g,
            "portion_hints": portion_hints(display["name"]),
        })
    return output


def select_bundle(foods, limit):
    def score(food):
        complete = sum(food["per100g"].get(key) is not None for key in NUTRIENTS)
        common = 20 if food.get("name_ru") else 0
        return common + complete
    ordered = sorted(foods, key=lambda food: (-score(food), food.get("name_ru") is None, food["name_en"]))
    return ordered if limit is None else ordered[:limit]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="combined markdown catalogue")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=None, help="omit for no cap (bundle every canonical food)")
    args = parser.parse_args()

    source_rows = parse_markdown(args.input)
    foods = merge(source_rows)
    selected = select_bundle(foods, args.limit)
    bundle = {
        "schema_version": 1, "generated_from": SOURCES, "foods": selected,
        "stats": {"source_rows": len(source_rows), "canonical_foods": len(foods), "bundled_foods": len(selected)},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(bundle["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
