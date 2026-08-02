"""LLM-шлюз: aitunnel (OpenAI-совместимый) сейчас, Yandex AI Studio — заменой env.

Наружу отдаётся только сырой текст ответа модели; разбор и границы — в домене.
Ошибки провайдера переводятся в ProviderUnavailableError без деталей наружу.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from nota.application.errors import FeatureDisabledError, ProviderUnavailableError

log = logging.getLogger("nota.llm")

DEFAULT_URLS = {
    "aitunnel": "https://api.aitunnel.ru/v1",
    "yandex": "https://ai.api.cloud.yandex.net/v1",
}


class DisabledGateway:
    """Fail closed: функция ИИ выключена — предсказуемый 403, ручной ввод работает."""

    enabled = False
    provider = "disabled"

    def complete_text(self, system: str, user: str, max_tokens: int) -> str:
        raise FeatureDisabledError()

    def complete_vision(self, system: str, user: str, image_data_url: str, max_tokens: int) -> str:
        raise FeatureDisabledError()


class OpenAICompatGateway:
    """Chat Completions контракт: aitunnel и Yandex AI Studio его разделяют.

    Различия провайдеров сведены к заголовкам и имени модели, поэтому переход
    aitunnel → Yandex — правка окружения, не кода.
    """

    enabled = True

    def __init__(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        text_model: str,
        vision_model: str,
        timeout: int = 60,
        folder_id: str = "",
    ):
        self.provider = provider
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._text_model = text_model
        self._vision_model = vision_model
        self._timeout = timeout
        self._folder_id = folder_id

    def _headers(self) -> dict:
        if self.provider == "yandex":
            headers = {"Authorization": f"Api-Key {self._key}", "x-data-logging-enabled": "false"}
            if self._folder_id:
                headers["x-folder-id"] = self._folder_id
            return headers
        return {"Authorization": f"Bearer {self._key}"}

    def _post_chat(self, model: str, messages: list, max_tokens: int) -> str:
        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        request = urllib.request.Request(
            f"{self._base}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", **self._headers()},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            log.warning("llm http error: provider=%s status=%s", self.provider, exc.code)
            raise ProviderUnavailableError() from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            log.warning("llm transport error: provider=%s err=%s", self.provider, type(exc).__name__)
            raise ProviderUnavailableError() from exc
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderUnavailableError() from exc
        if not isinstance(content, str) or not content.strip():
            raise ProviderUnavailableError()
        return content

    def complete_text(self, system: str, user: str, max_tokens: int) -> str:
        return self._post_chat(
            self._text_model,
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens,
        )

    def complete_vision(self, system: str, user: str, image_data_url: str, max_tokens: int) -> str:
        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ]
        return self._post_chat(self._vision_model, messages, max_tokens)
