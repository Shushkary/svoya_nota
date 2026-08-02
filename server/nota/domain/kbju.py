"""Чистые правила КБЖУ: разбор ответа модели и физиологические границы.

Модуль не импортирует HTTP-клиенты, FastAPI и БД. Ответ модели — недоверенный
текст; сначала извлекается первый JSON-объект, затем значения приводятся к
физиологически осмысленным границам. Оценка модели всегда помечается
confidence < 1 и никогда не выдаётся за измерение.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

KCAL_MAX = 4000          # одна порция; сутки проверяются на клиенте
MACRO_MAX_G = 400.0
KCAL_PER = {"protein": 4.0, "carb": 4.0, "fat": 9.0}


class EstimateParseError(ValueError):
    """Ответ модели не содержит пригодного JSON с КБЖУ."""


@dataclass(frozen=True)
class MealEstimate:
    description: str
    kcal: int
    protein_g: float
    fat_g: float
    carb_g: float
    confidence: float
    comment: str
    fiber_g: float = 0.0
    sodium_mg: float = 0.0
    potassium_mg: float = 0.0
    magnesium_mg: float = 0.0


def _first_json_object(text: str) -> dict:
    """Извлекает первый JSON-объект из произвольного текста модели."""
    if not isinstance(text, str) or not text.strip():
        raise EstimateParseError("empty model output")
    fenced = re.sub(r"```(?:json)?|```", "", text)
    start = fenced.find("{")
    if start < 0:
        raise EstimateParseError("no JSON object in model output")
    depth = 0
    for i in range(start, len(fenced)):
        ch = fenced[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(fenced[start : i + 1])
                except json.JSONDecodeError as exc:
                    raise EstimateParseError(f"invalid JSON: {exc}") from exc
                if not isinstance(parsed, dict):
                    raise EstimateParseError("model JSON is not an object")
                return parsed
    raise EstimateParseError("unbalanced JSON object")


def _num(raw: object, lo: float, hi: float, default: float = 0.0) -> float:
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    if value != value or value in (float("inf"), float("-inf")):
        return default
    return min(max(value, lo), hi)


def parse_estimate(text: str, fallback_description: str = "") -> MealEstimate:
    """Строгий разбор ответа модели с приведением к границам."""
    data = _first_json_object(text)
    protein = round(_num(data.get("protein_g"), 0.0, MACRO_MAX_G), 1)
    fat = round(_num(data.get("fat_g"), 0.0, MACRO_MAX_G), 1)
    carb = round(_num(data.get("carb_g"), 0.0, MACRO_MAX_G), 1)
    fiber = round(_num(data.get("fiber_g"), 0.0, 200.0), 1)
    sodium = round(_num(data.get("sodium_mg"), 0.0, 20_000.0), 0)
    potassium = round(_num(data.get("potassium_mg"), 0.0, 20_000.0), 0)
    magnesium = round(_num(data.get("magnesium_mg"), 0.0, 5_000.0), 0)
    kcal = int(_num(data.get("kcal"), 0.0, float(KCAL_MAX)))
    macro_kcal = protein * KCAL_PER["protein"] + carb * KCAL_PER["carb"] + fat * KCAL_PER["fat"]
    # Если калории не согласуются с макросами более чем вдвое — доверяем макросам.
    if macro_kcal > 0 and (kcal <= 0 or kcal > macro_kcal * 2 or kcal * 2 < macro_kcal):
        kcal = int(min(macro_kcal, KCAL_MAX))
    description = data.get("description")
    if not isinstance(description, str) or not description.strip():
        description = fallback_description
    comment = data.get("comment")
    if not isinstance(comment, str):
        comment = ""
    confidence = _num(data.get("confidence"), 0.05, 0.95, default=0.5)
    return MealEstimate(
        description=description.strip()[:300],
        kcal=kcal,
        protein_g=protein,
        fat_g=fat,
        carb_g=carb,
        confidence=round(confidence, 2),
        comment=comment.strip()[:400],
        fiber_g=fiber,
        sodium_mg=sodium,
        potassium_mg=potassium,
        magnesium_mg=magnesium,
    )
