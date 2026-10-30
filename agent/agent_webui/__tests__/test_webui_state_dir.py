"""The webui's application state lives under meristem's data directory."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _resolved_dirs(tmp_path: Path, **env: str) -> list[str]:
    code = (
        'import agent_webui.api_extensions as m;'
        'print(m._WEBUI_DATA_DIR);print(m.DEFAULT_AGENT_DIR)'
    )
    run_env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(('MERISTEM_', 'AGENT_UTILITIES_'))
    }
    run_env.update(HOME=str(tmp_path), XDG_DATA_HOME=str(tmp_path / 'share'), **env)
    out = subprocess.run(
        [sys.executable, '-c', code],
        env=run_env,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return out.stdout.strip().splitlines()[-2:]


def test_webui_state_follows_meristem_data_dir(tmp_path: Path) -> None:
    target = tmp_path / 'meristem-data'
    webui, workspace = _resolved_dirs(tmp_path, MERISTEM_DATA_DIR=str(target))
    assert Path(webui) == target / 'webui'
    assert Path(workspace) == target / 'webui' / 'workspace'


def test_webui_state_never_uses_the_retired_agent_utilities_dir(tmp_path: Path) -> None:
    webui, _ = _resolved_dirs(
        tmp_path, AGENT_UTILITIES_DATA_DIR=str(tmp_path / 'legacy')
    )
    assert 'agent-utilities' not in webui
    assert not webui.startswith(str(tmp_path / 'legacy'))
    assert Path(webui) == tmp_path / 'share' / 'meristem' / 'webui'
