"""Единственное место чтения окружения и выбора адаптеров."""

from __future__ import annotations

import os

from nota.adapters.llm_gateway import DEFAULT_URLS, DisabledGateway, OpenAICompatGateway
from nota.adapters.chestny_znak_catalog import ChestnyZnakCatalog
from nota.adapters.fallback_catalog import FallbackCatalog
from nota.adapters.open_food_facts_catalog import OpenFoodFactsCatalog
from nota.adapters.sqlite_repository import SqliteRepository
from nota.application.admin_auth import validate_configuration as validate_admin_configuration
from nota.application.services import Limits, Services
from nota.presentation.api import build_app

VERSION = "1.0.0"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _optional_limit_env(name: str, default: int | None) -> int | None:
    """Zero disables a configurable commercial limit; invalid values fail safe."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return None if value == 0 else max(1, value)


def create_app():
    validate_admin_configuration()
    db_path = os.environ.get("NOTA_DB_PATH", "./nota.db")
    repo = SqliteRepository(db_path)

    provider = os.environ.get("NOTA_LLM_PROVIDER", "disabled").strip().lower()
    api_key = os.environ.get("NOTA_LLM_API_KEY", "").strip()
    if provider in ("aitunnel", "yandex") and api_key:
        gateway = OpenAICompatGateway(
            provider=provider,
            base_url=os.environ.get("NOTA_LLM_URL", DEFAULT_URLS[provider]),
            api_key=api_key,
            # Выбор по цене/качеству для aitunnel: текст — самый дешёвый flash-lite,
            # фото — flash с сильным зрением. Переопределяются через env.
            text_model=os.environ.get("NOTA_TEXT_MODEL", "gemini-3.1-flash-lite"),
            vision_model=os.environ.get("NOTA_VISION_MODEL", "gemini-2.5-flash"),
            timeout=_int_env("NOTA_LLM_TIMEOUT", 60),
            folder_id=os.environ.get("NOTA_YANDEX_FOLDER_ID", ""),
        )
    else:
        # Fail closed: без ключа или при неизвестном провайдере ИИ выключен.
        gateway = DisabledGateway()

    limits = Limits(
        meal_text_per_day=_int_env("NOTA_MEAL_TEXT_DAILY", 40),
        meal_photo_per_day=_int_env("NOTA_MEAL_PHOTO_DAILY", 10),
        meal_photo_lifetime=_optional_limit_env("NOTA_MEAL_PHOTO_LIFETIME", 4),
        global_llm_per_day=_int_env("NOTA_LLM_GLOBAL_DAILY", 200),
    )
    barcode_timeout = _int_env("NOTA_BARCODE_TIMEOUT", 5)
    catalog = FallbackCatalog(
        ChestnyZnakCatalog(
            token=os.environ.get("NOTA_CHESTNY_ZNAK_TOKEN", ""),
            timeout_seconds=barcode_timeout,
            url=os.environ.get("NOTA_CHESTNY_ZNAK_URL", ""),
        ),
        OpenFoodFactsCatalog(
            timeout_seconds=barcode_timeout,
            user_agent=os.environ.get("NOTA_BARCODE_USER_AGENT", "SvoyaNota/1.0 (https://torion.shop)"),
        ),
    )
    services = Services(repo, gateway, limits, catalog=catalog)
    return build_app(services, VERSION, gateway.provider)
