"""Adapter for the Russian National Catalogue / Chestny ZNAK True API.

The adapter deliberately receives a GTIN only.  A full DataMatrix contains a
serial number and crypto tail which are not needed to identify a food product,
so they never leave the browser for this lookup.

True API access is an operator credential and is therefore configured only on
the server through NOTA_CHESTNY_ZNAK_TOKEN.  It is never exposed to the web
client or written to the product cache.
"""

from __future__ import annotations

import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from nota.adapters.open_food_facts_catalog import CatalogueUnavailable
from nota.domain.barcode import BarcodeProduct

_DEFAULT_URL = "https://markirovka.crpt.ru/api/v4/true-api/product/info"
_MAX_RESPONSE_BYTES = 256_000
_NAME_KEYS = ("productName", "fullName", "name", "product_name", "title")
_BRAND_KEYS = ("brand", "brandName", "trademark", "tradeMark")


class ChestnyZnakCatalog:
    """Read public product-card attributes from the Russian marking system."""

    source = "chestny_znak"

    def __init__(self, *, token: str, timeout_seconds: float = 5.0, url: str = _DEFAULT_URL):
        self._token = token.strip()
        self._timeout = max(1.0, timeout_seconds)
        self._url = url.strip() or _DEFAULT_URL

    @property
    def enabled(self) -> bool:
        return bool(self._token)

    def find(self, code: str) -> BarcodeProduct | None:
        if not self.enabled:
            return None
        gtin = _gtin14(code)
        if not gtin:
            return None
        body = json.dumps({"gtins": [gtin]}, separators=(",", ":")).encode("utf-8")
        request = Request(
            self._url,
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._token}",
            },
        )
        try:
            with urlopen(request, timeout=self._timeout) as response:
                payload = response.read(_MAX_RESPONSE_BYTES + 1)
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise CatalogueUnavailable() from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CatalogueUnavailable() from exc
        if len(payload) > _MAX_RESPONSE_BYTES:
            raise CatalogueUnavailable()
        try:
            data = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CatalogueUnavailable() from exc
        card = _matching_card(data, gtin)
        if card is None:
            return None
        name = _first_text(card, _NAME_KEYS)
        if not name:
            return None
        nutrition = card.get("nutriments") if isinstance(card.get("nutriments"), dict) else {}
        kcal = _number(nutrition.get("energy-kcal_100g"))
        # Nutrition declaration is optional in the National Catalogue.  A
        # product name is still useful, but the UI must ask for the label.
        has_nutrition = kcal is not None
        return BarcodeProduct(
            code=gtin,
            name=name[:160],
            brand=_first_text(card, _BRAND_KEYS)[:100],
            kcal_100g=kcal,
            protein_100g=_number(nutrition.get("proteins_100g")) if has_nutrition else None,
            fat_100g=_number(nutrition.get("fat_100g")) if has_nutrition else None,
            carb_100g=_number(nutrition.get("carbohydrates_100g")) if has_nutrition else None,
            fiber_100g=_number(nutrition.get("fiber_100g")) if has_nutrition else None,
            sugars_100g=_number(nutrition.get("sugars_100g")) if has_nutrition else None,
            sodium_mg_100g=_milligrams(nutrition.get("sodium_100g")) if has_nutrition else None,
            source=self.source,
            nutrition_available=has_nutrition,
        )


def _gtin14(code: str) -> str:
    digits = "".join(char for char in str(code) if char.isdigit())
    return digits.zfill(14) if len(digits) == 13 else digits if len(digits) == 14 else ""


def _matching_card(data: object, gtin: str) -> dict | None:
    for card in _cards(data):
        card_gtin = _gtin14(card.get("gtin", ""))
        if card_gtin in ("", gtin):
            return card
    return None


def _cards(value: object):
    if isinstance(value, list):
        for item in value:
            yield from _cards(item)
    elif isinstance(value, dict):
        if any(key in value for key in _NAME_KEYS):
            yield value
        for key in ("results", "products", "items", "data"):
            nested = value.get(key)
            if isinstance(nested, (dict, list)):
                yield from _cards(nested)


def _first_text(data: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _number(value: object) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def _milligrams(value: object) -> float | None:
    grams = _number(value)
    return round(grams * 1000, 2) if grams is not None else None
