import pytest

from nota.domain.kbju import EstimateParseError, parse_estimate


def test_parses_plain_json():
    est = parse_estimate(
        '{"description":"Гречка с курицей","kcal":420,"protein_g":32,"fat_g":10,'
        '"carb_g":48,"confidence":0.8,"comment":"обычная порция"}'
    )
    assert est.kcal == 420
    assert est.protein_g == 32.0
    assert est.confidence == 0.8
    assert est.description == "Гречка с курицей"


def test_parses_json_in_markdown_fence_with_prose():
    est = parse_estimate('Вот оценка:\n```json\n{"kcal": 300, "protein_g": 10, '
                         '"fat_g": 5, "carb_g": 50, "confidence": 0.6}\n```\nГотово.')
    assert est.kcal == 300


def test_kcal_reconciled_with_macros_when_inconsistent():
    est = parse_estimate('{"kcal": 5, "protein_g": 30, "fat_g": 20, "carb_g": 40, "confidence": 0.9}')
    # 30*4 + 40*4 + 20*9 = 460; kcal=5 несогласован — берём макросы
    assert est.kcal == 460


def test_negative_and_huge_values_clamped():
    est = parse_estimate('{"kcal": 999999, "protein_g": -5, "fat_g": 9999, "carb_g": 10, "confidence": 3}')
    assert est.kcal <= 4000
    assert est.protein_g == 0.0
    assert est.fat_g == 400.0
    assert est.confidence == 0.95


def test_missing_fields_default_but_not_crash():
    est = parse_estimate('{"kcal": 100}', fallback_description="чай")
    assert est.description == "чай"
    assert est.protein_g == 0.0


def test_garbage_raises():
    with pytest.raises(EstimateParseError):
        parse_estimate("модель ответила прозой без JSON")
    with pytest.raises(EstimateParseError):
        parse_estimate("")
    with pytest.raises(EstimateParseError):
        parse_estimate('{"kcal": }')
