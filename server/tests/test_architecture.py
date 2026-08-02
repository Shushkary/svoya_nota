"""Правила зависимостей чистой архитектуры исполняются тестом."""

import ast
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]

FORBIDDEN = {
    "domain": {"fastapi", "pydantic", "sqlite3", "urllib", "httpx", "requests",
               "nota.adapters", "nota.application", "nota.presentation"},
    "application": {"fastapi", "pydantic", "sqlite3", "urllib", "httpx", "requests",
                    "nota.adapters", "nota.presentation"},
    # Маршруты работают через порты и сервисы; конкретные адаптеры выбирает composition.
    "presentation": {"sqlite3", "urllib", "httpx", "requests", "nota.adapters"},
}


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def _layer_files(layer: str):
    # rglob, а не glob: подпакеты слоя тоже обязаны соблюдать правила.
    return [p for p in (SERVER / "nota" / layer).rglob("*.py")
            if "__pycache__" not in p.parts]


@pytest.mark.parametrize("layer", sorted(FORBIDDEN))
def test_layer_dependencies(layer):
    files = _layer_files(layer)
    assert files, f"слой {layer} не найден — проверьте раскладку пакетов"
    for file in files:
        for module in _imports(file):
            for banned in FORBIDDEN[layer]:
                assert not (module == banned or module.startswith(banned + ".")), (
                    f"{file.relative_to(SERVER)} ({layer}) imports forbidden {module}"
                )


def test_only_composition_wires_adapters():
    """Конкретные адаптеры подключаются в одном месте — composition.py.

    Иначе выбор реализации расползается по слоям и заменить хранилище или
    провайдера становится нельзя без правок в нескольких местах.
    """
    offenders = []
    for file in (SERVER / "nota").rglob("*.py"):
        if "__pycache__" in file.parts or file.name == "composition.py":
            continue
        if file.parts[-2] == "adapters":
            continue  # адаптеры видят друг друга: FallbackCatalog оборачивает каталоги
        if any(module.startswith("nota.adapters") for module in _imports(file)):
            offenders.append(str(file.relative_to(SERVER)))
    assert not offenders, f"адаптеры подключаются вне composition.py: {offenders}"
