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
    import pytest

    pytest.register_assert_rewrite(_MODULE_NAME)
    _spec = importlib.util.spec_from_file_location(_MODULE_NAME, _SHARED_FIXTURES_SRC)
    if _spec is not None and _spec.loader is not None:
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules[_MODULE_NAME] = _mod
        _spec.loader.exec_module(_mod)

pytest_plugins = [_MODULE_NAME]


import pytest as _pytest


@_pytest.fixture(autouse=True)
def _reset_fleet_catalog_cache():
    """Clear the module-level fleet-catalog TTL cache before every test.

    `api_extensions._fleet_catalog_cache`/`_fleet_catalog_last_synced_seen`
    (FIX LANE Priority 3) are process-lifetime module state, not per-request
    -- without this, a test earlier in the same pytest session that
    populates the cache for a `kind` makes a LATER test's patch of
    `_read_fleet_catalog`/`registry_api` silently never take effect (a cache
    hit skips the engine read entirely), which would look like the patched
    test is exercising the read path when it is actually reading stale data
    left over from a different test.
    """
    from agent_webui import api_extensions

    api_extensions.reset_fleet_catalog_cache()
    yield
    api_extensions.reset_fleet_catalog_cache()
