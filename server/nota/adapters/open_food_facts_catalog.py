"""HTTP adapter for the public Open Food Facts product catalogue.

Only a GTIN is sent to the upstream service.  The caller never sends a photo,
device token or other user data to the external catalogue.
"""

from __future__ import annotations

import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from nota.domain.barcode import BarcodeProduct

_FIELDS = "product_name,product_name_ru,brands,nutriments,nova_group"
_MAX_RESPONSE_BYTES = 128_000


class CatalogueUnavailable(Exception):
    """The upstream catalogue did not answer safely within the timeout."""


class OpenFoodFactsCatalog:
    source = "open_food_facts"

    def __init__(self, *, timeout_seconds: float = 5.0, user_agent: str = "SvoyaNota/1.0 (https://torion.shop)"):
        self._timeout = max(1.0, timeout_seconds)
        self._user_agent = user_agent

    def find(self, code: str) -> BarcodeProduct | None:
        # True API uses a canonical 14-digit GTIN, while the community
        # catalogue often indexes the same Russian code as EAN-13.  Preserve
        # both forms so enabling the official source cannot reduce fallback
        # coverage.
        candidates = (code, code[1:]) if len(code) == 14 and code.startswith("0") else (code,)
        for candidate in candidates:
            url = f"https://world.openfoodfacts.org/api/v3/product/{candidate}?fields={_FIELDS}"
            request = Request(url, headers={"Accept": "application/json", "User-Agent": self._user_agent})
            try:
                with urlopen(request, timeout=self._timeout) as response:
                    payload = response.read(_MAX_RESPONSE_BYTES + 1)
            except HTTPError as exc:
                if exc.code == 404:
                    continue
                raise CatalogueUnavailable() from exc
            except (URLError, TimeoutError, OSError) as exc:
                raise CatalogueUnavailable() from exc
            if len(payload) > _MAX_RESPONSE_BYTES:
                raise CatalogueUnavailable()
            try:
                data = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise CatalogueUnavailable() from exc
            product = data.get("product") if isinstance(data, dict) else None
            if not isinstance(product, dict):
                continue
            nutriments = product.get("nutriments")
            if not isinstance(nutriments, dict):
                continue
            name = _text(product.get("product_name_ru")) or _text(product.get("product_name"))
            kcal = _number(nutriments.get("energy-kcal_100g"))
            if not name or kcal is None:
                continue
            return BarcodeProduct(
                code=code,
                name=name[:160],
                brand=_text(product.get("brands"))[:100],
                kcal_100g=kcal,
                protein_100g=_number(nutriments.get("proteins_100g")) or 0,
                fat_100g=_number(nutriments.get("fat_100g")) or 0,
                carb_100g=_number(nutriments.get("carbohydrates_100g")) or 0,
                fiber_100g=_number(nutriments.get("fiber_100g")),
                sugars_100g=_number(nutriments.get("sugars_100g")),
                sodium_mg_100g=_milligrams(nutriments.get("sodium_100g")),
                nova_group=_nova(product.get("nova_group")),
            )
        return None


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: object) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def _milligrams(value: object) -> float | None:
    grams = _number(value)
    return round(grams * 1000, 2) if grams is not None else None


def _nova(value: object) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result in (1, 2, 3, 4) else None
