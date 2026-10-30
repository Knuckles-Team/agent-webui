"""Importing an optional UI must preserve host tracing and machine stdout."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.spec('OVERSTORY-API-R011.1')
@pytest.mark.parametrize('enabled', [False, True])
def test_import_preserves_disabled_host_or_routes_enabled_console(tmp_path, enabled):
    script = """
import json
import sys
import logfire
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

exporter = InMemorySpanExporter()
logfire.configure(send_to_logfire=False, console=False,
                  additional_span_processors=[SimpleSpanProcessor(exporter)])
configure = logfire.configure
calls = []
def capture(**kwargs):
    calls.append(kwargs)
    return configure(**kwargs)
logfire.configure = capture
import overstory.server
logfire.info('host-console-regression')
enabled = sys.argv[1] == 'true'
if enabled:
    assert len(calls) == 1
    assert calls[0]['send_to_logfire'] == 'if-token-present'
    assert calls[0]['console'].output is sys.stderr
else:
    assert calls == []
    assert any(span.name == 'host-console-regression'
               for span in exporter.get_finished_spans())
print(json.dumps({'ok': True}))
"""
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(('LOGFIRE_', 'OTEL_'))
    }
    env.update(
        OVERSTORY_LOGFIRE_ENABLED='true' if enabled else 'false',
        HOME=str(tmp_path),
        XDG_CONFIG_HOME=str(tmp_path / 'config'),
        XDG_DATA_HOME=str(tmp_path / 'data'),
        PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'agent'),
    )
    script_path = tmp_path / 'import_console_probe.py'
    script_path.write_text(script)
    result = subprocess.run(
        [sys.executable, str(script_path), 'true' if enabled else 'false'],
        env=env,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {'ok': True}
    if enabled:
        assert 'host-console-regression' in result.stderr
