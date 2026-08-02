import json

from nota.adapters.chestny_znak_catalog import ChestnyZnakCatalog


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode("utf-8")

    def read(self, _limit):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_chestny_znak_uses_canonical_gtin_and_keeps_missing_nutrition_empty(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["authorization"] = request.get_header("Authorization")
        return _Response({
            "results": [{
                "gtin": "04600682000655",
                "productName": "Молоко ультрапастеризованное",
                "brand": "Тестовая марка",
            }]
        })

    monkeypatch.setattr("nota.adapters.chestny_znak_catalog.urlopen", fake_urlopen)

    product = ChestnyZnakCatalog(token="server-only-token", timeout_seconds=3).find("4600682000655")

    assert captured["url"].endswith("/api/v4/true-api/product/info")
    assert captured["body"] == {"gtins": ["04600682000655"]}
    assert captured["authorization"] == "Bearer server-only-token"
    assert captured["timeout"] == 3
    assert product is not None
    assert product.code == "04600682000655"
    assert product.name == "Молоко ультрапастеризованное"
    assert product.nutrition_available is False
    assert product.kcal_100g is None


def test_chestny_znak_returns_nutrition_only_when_explicitly_present(monkeypatch):
    monkeypatch.setattr(
        "nota.adapters.chestny_znak_catalog.urlopen",
        lambda *_args, **_kwargs: _Response({
            "products": [{
                "gtin": "04600682000655",
                "name": "Йогурт",
                "nutriments": {
                    "energy-kcal_100g": 90,
                    "proteins_100g": 3.2,
                    "fat_100g": 2.5,
                    "carbohydrates_100g": 11,
                },
            }]
        }),
    )

    product = ChestnyZnakCatalog(token="token").find("04600682000655")

    assert product is not None
    assert product.nutrition_available is True
    assert product.kcal_100g == 90
    assert product.protein_100g == 3.2
