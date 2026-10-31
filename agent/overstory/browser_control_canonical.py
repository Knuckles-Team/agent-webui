"""Cross-runtime canonical JSON subset for the browser-control protocol."""

from __future__ import annotations

import json
from typing import Any

_MAX_SAFE_INTEGER = 2**53 - 1
_MAX_JSON_DEPTH = 64


def _valid_unicode(value: str) -> str:
    try:
        value.encode('utf-8', errors='strict')
    except UnicodeEncodeError as error:
        raise ValueError('browser-control JSON contains invalid Unicode') from error
    return value


def validate_protocol_json(value: Any, *, _depth: int = 0) -> Any:
    """Accept only JSON values with byte-identical Python/JavaScript encoding."""

    if _depth > _MAX_JSON_DEPTH:
        raise ValueError('browser-control JSON is too deeply nested')
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return _valid_unicode(value)
    if type(value) is int:
        return _safe_integer(value)
    if isinstance(value, list):
        return _validated_list(value, _depth)
    if isinstance(value, dict):
        return _validated_object(value, _depth)
    raise ValueError('browser-control JSON contains an unsupported value')


def _safe_integer(value: int) -> int:
    if -_MAX_SAFE_INTEGER <= value <= _MAX_SAFE_INTEGER:
        return value
    raise ValueError('browser-control JSON integer is outside the safe range')


def _validated_list(value: list[Any], depth: int) -> list[Any]:
    return [validate_protocol_json(item, _depth=depth + 1) for item in value]


def _validated_object(value: dict[Any, Any], depth: int) -> dict[str, Any]:
    checked: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError('browser-control JSON object keys must be strings')
        checked[_valid_unicode(key)] = validate_protocol_json(item, _depth=depth + 1)
    return checked


def _utf16_key(value: str) -> bytes:
    return value.encode('utf-16-be')


def _canonical_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _canonical_value(value[key]) for key in sorted(value, key=_utf16_key)
        }
    return value


def _reject_constant(value: str) -> None:
    raise ValueError(f'non-finite JSON value is forbidden: {value}')


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    candidate: dict[str, Any] = {}
    for key, value in pairs:
        if key in candidate:
            raise ValueError('duplicate JSON object key is forbidden')
        candidate[key] = value
    return candidate


def parse_protocol_json(value: str | bytes | bytearray) -> Any:
    """Parse JSON without duplicate keys and validate the canonical subset."""

    candidate = json.loads(
        value,
        parse_constant=_reject_constant,
        object_pairs_hook=_unique_object,
    )
    return validate_protocol_json(candidate)


def canonical_protocol_json(value: Any) -> str:
    """Serialize the strict subset using JavaScript UTF-16 object-key order."""

    checked = validate_protocol_json(value)
    return json.dumps(
        _canonical_value(checked),
        ensure_ascii=False,
        allow_nan=False,
        separators=(',', ':'),
    )


__all__ = [
    'canonical_protocol_json',
    'parse_protocol_json',
    'validate_protocol_json',
]
