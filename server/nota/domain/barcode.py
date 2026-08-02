"""Public product data returned by a barcode catalogue."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BarcodeProduct:
    code: str
    name: str
    brand: str
    # The National Catalogue can identify a product without publishing its
    # nutrition declaration.  Do not fabricate KБЖУ in that case: callers
    # receive an identified product with nutrition_available=False instead.
    kcal_100g: float | None
    protein_100g: float | None
    fat_100g: float | None
    carb_100g: float | None
    fiber_100g: float | None = None
    sugars_100g: float | None = None
    sodium_mg_100g: float | None = None
    nova_group: int | None = None
    source: str = "open_food_facts"
    nutrition_available: bool = True
