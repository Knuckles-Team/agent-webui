"""WEBUI-API-R005: failure logs carry a sanitized typed error code."""

from __future__ import annotations

import logging

import agent_webui.api_extensions as mod


class _EngineError(RuntimeError):
    def __init__(self, code: object) -> None:
        super().__init__('secret query text MATCH (n) RETURN n')
        self.engine_error_code = code


def _logged(caplog, error: BaseException) -> str:
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger=mod.logger.name):
        mod._log_failure('read_union.per_graph', error, level=logging.WARNING)
    return caplog.records[-1].getMessage()


# spec: WEBUI-API-R005
def test_typed_engine_code_is_logged(caplog):
    message = _logged(caplog, _EngineError('ACCESS_DENIED'))
    assert message == (
        'read_union.per_graph failed: error_type=_EngineError error_code=ACCESS_DENIED'
    )


# spec: WEBUI-API-R005
def test_message_text_never_reaches_the_log(caplog):
    message = _logged(caplog, _EngineError('ACCESS_DENIED'))
    assert 'secret' not in message
    assert 'MATCH' not in message


# spec: WEBUI-API-R005
def test_malformed_or_missing_code_logs_none(caplog):
    for code in (None, 'access denied; graph=x', 'x' * 80, 403):
        assert _logged(caplog, _EngineError(code)).endswith('error_code=none')
    assert _logged(caplog, ValueError('boom')).endswith('error_code=none')


# spec: WEBUI-API-R005
def test_error_code_length_boundary(caplog):
    accepted = 'A' * 64
    refused = 'A' * 65
    assert _logged(caplog, _EngineError(accepted)).endswith(f'error_code={accepted}')
    assert _logged(caplog, _EngineError(refused)).endswith('error_code=none')


class _CodedError(OSError):
    def __init__(self, code: str) -> None:
        super().__init__('boom')
        self.code = code


# spec: WEBUI-API-R005
def test_plain_code_attribute_is_used(caplog):
    error = _CodedError('UNAVAILABLE')
    assert _logged(caplog, error).endswith('error_code=UNAVAILABLE')
