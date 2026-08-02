import pytest

from nota.application.admin_auth import validate_configuration


def test_admin_configuration_fails_closed_without_secret(monkeypatch):
    monkeypatch.setenv("NOTA_ADMIN_PASSWORD_HASH", "00:00")
    monkeypatch.delenv("NOTA_ADMIN_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="NOTA_ADMIN_SECRET"):
        validate_configuration()


def test_admin_configuration_accepts_long_secret(monkeypatch):
    monkeypatch.setenv("NOTA_ADMIN_PASSWORD_HASH", "00:00")
    monkeypatch.setenv("NOTA_ADMIN_SECRET", "x" * 32)

    validate_configuration()
