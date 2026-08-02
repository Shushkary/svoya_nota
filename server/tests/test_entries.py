import pytest

from nota.domain.entries import EntryValidationError, validate_entry


def test_valid_entry_roundtrip():
    entry = validate_entry("state", "abc-1", "2026-07-20T09:00:00+03:00", '{"calm":4}')
    assert entry.kind == "state"


@pytest.mark.parametrize("revision", [
    "2026-07-20", "2026-07-20T09:00:00+03:00", "2026-99-99T09:00:00Z",
    "2026-07-20Tnot-a-timeZ",
])
def test_explicit_revision_must_be_canonical_utc_instant(revision):
    with pytest.raises(EntryValidationError):
        validate_entry("state", "abc-1", "2026-07-20", "{}", revision)


def test_explicit_canonical_revision_is_accepted():
    entry = validate_entry(
        "state", "abc-1", "2026-07-20", "{}", "2026-07-20T09:00:00.123Z"
    )
    assert entry.updated_at == "2026-07-20T09:00:00.123Z"


@pytest.mark.parametrize("kind", ["", "unknown", "meal2"])
def test_unknown_kind_rejected(kind):
    with pytest.raises(EntryValidationError):
        validate_entry(kind, "abc", "2026-07-20", "{}")


def test_oversized_payload_rejected():
    with pytest.raises(EntryValidationError):
        validate_entry("state", "abc", "2026-07-20", "x" * 20_000)


@pytest.mark.parametrize("payload", ["{", "[]", "null"])
def test_payload_must_be_json_object(payload):
    with pytest.raises(EntryValidationError):
        validate_entry("state", "abc", "2026-07-20", payload)


def test_all_journal_kinds_accepted():
    for kind in ("state", "practice", "meal", "will", "activity", "profile", "ritual"):
        validate_entry(kind, "id-1", "2026-07-20", "{}")
