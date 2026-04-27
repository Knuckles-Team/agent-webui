"""Pytest configuration for tests colocated with source under
``agent/agent_webui/__tests__/``.

The shared fixtures (``mock_agent``, ``mock_workspace_helpers``,
``mock_graph_engine``, etc.) live in the top-level ``tests/conftest.py``.
Because ``tests/`` and ``agent/`` are sibling directories under the project
root, pytest's implicit conftest-discovery does not walk up far enough to
share them across both suites.

We expose the shared fixtures here by loading ``tests/conftest.py`` as a
normal module under a distinct name and declaring it as a pytest plugin via
``pytest_plugins``. This keeps the canonical fixture definitions in one place
while making them available to both test suites.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_SHARED_FIXTURES_SRC = Path(__file__).resolve().parents[3] / 'tests' / 'conftest.py'

_MODULE_NAME = '_agent_webui_shared_fixtures'

if _SHARED_FIXTURES_SRC.is_file() and _MODULE_NAME not in sys.modules:
    _spec = importlib.util.spec_from_file_location(_MODULE_NAME, _SHARED_FIXTURES_SRC)
    if _spec is not None and _spec.loader is not None:
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules[_MODULE_NAME] = _mod
        _spec.loader.exec_module(_mod)

pytest_plugins = [_MODULE_NAME]
