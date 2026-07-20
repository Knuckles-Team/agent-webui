"""Source-level regression checks for privacy-safe WebUI diagnostics."""

import re
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
API_SOURCE = (
    PACKAGE_ROOT / 'agent' / 'agent_webui' / 'api_extensions.py'
).read_text(encoding='utf-8')
SERVER_SOURCE = (PACKAGE_ROOT / 'agent' / 'agent_webui' / 'server.py').read_text(
    encoding='utf-8'
)


def test_exception_objects_are_not_interpolated_into_logs() -> None:
    unsafe = re.compile(
        r"logger\.(?:debug|info|warning|error|exception)\(f?['\"][^\n]*(?:\{e\}|\{exc\})"
    )
    assert not unsafe.search(API_SOURCE)
    assert not unsafe.search(SERVER_SOURCE)


def test_private_writes_are_atomic_and_link_resistant() -> None:
    assert 'def _atomic_private_write' in API_SOURCE
    assert 'os.O_EXCL' in API_SOURCE
    assert 'os.O_NOFOLLOW' in API_SOURCE
    assert 'os.replace(temp_path, target)' in API_SOURCE
    assert 'os.chmod(target, 0o600)' in API_SOURCE


def test_environment_specific_paths_are_not_embedded() -> None:
    lowered = (API_SOURCE + SERVER_SOURCE).lower()
    assert '/home/' not in lowered
    assert 'c:\\\\users\\\\' not in lowered


def test_durable_identities_use_canonical_persistence_references() -> None:
    assert 'persistence_reference' in API_SOURCE
    assert "persistence_reference('principal', text, namespace='webui')" in API_SOURCE
    assert "'conversation', entry.chat_id, namespace='webui'" in API_SOURCE
    assert "return str(actor)" not in API_SOURCE


def test_durable_object_set_payloads_are_sanitized() -> None:
    assert 'safe_sets, _privacy_report = sanitize_for_persistence(normalized_sets)' in API_SOURCE
    assert 'safe_record, _privacy_report = sanitize_for_persistence(record)' in API_SOURCE
