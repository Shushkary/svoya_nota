import os
from pathlib import Path

# Локальная разработка: если рядом лежит app/server/.env — подхватываем из него
# переменные окружения (ключ ИИ-провайдера и т.п.) ДО чтения их в composition.
# В проде переменные приходят из systemd EnvironmentFile (/etc/nota/api.env);
# .env в репозиторий не коммитится и реальные OS-переменные имеют приоритет.
_env_file = Path(__file__).with_name(".env")
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _value = _line.split("=", 1)
        os.environ.setdefault(_key.strip(), _value.strip().strip('"').strip("'"))

from nota.composition import create_app  # noqa: E402  (импорт после загрузки .env)

app = create_app()
