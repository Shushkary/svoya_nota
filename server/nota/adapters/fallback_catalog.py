"""Ordered catalogue adapter with a resilient fallback path."""

from __future__ import annotations

from nota.adapters.open_food_facts_catalog import CatalogueUnavailable
from nota.domain.barcode import BarcodeProduct


class FallbackCatalog:
    """Prefer a Russian official source without making one outage a dead end."""

    source = "fallback_catalog"

    def __init__(self, *catalogs):
        self._catalogs = tuple(catalogs)

    def find(self, code: str) -> BarcodeProduct | None:
        answered = False
        last_error: Exception | None = None
        for catalog in self._catalogs:
            try:
                product = catalog.find(code)
                answered = True
            except CatalogueUnavailable as exc:
                last_error = exc
                continue
            if product is not None:
                return product
        if not answered and last_error is not None:
            raise CatalogueUnavailable() from last_error
        return None
