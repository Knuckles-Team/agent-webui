"""Source regressions for the runner, not installed-candidate acceptance."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from . import run_installed


@pytest.mark.parametrize('exit_code', [0, 1, 5])
def test_protocol_execution_is_isolated_and_failure_is_not_acceptance(
    monkeypatch, tmp_path, exit_code
):
    output = tmp_path / 'evidence'
    interpreter = tmp_path / 'candidate' / 'bin' / 'python'
    monkeypatch.setattr(
        sys,
        'argv',
        ['run_installed.py', '--python', str(interpreter), '--output', str(output)],
    )
    monkeypatch.setenv('PYTHONPATH', '/untrusted-source-overlay')
    monkeypatch.setenv('OVERSTORY_AUTH_MODE', 'none')
    observed = []

    def run(command, *, cwd, env, check, timeout):
        observed.append(command)
        assert command == [str(interpreter), '-m', 'pytest', '-q', 'qualification']
        assert cwd != Path(__file__).resolve().parent
        assert (cwd / 'qualification' / 'test_composed_modes.py').is_file()
        assert (cwd / 'qualification' / 'test_oidc_lifecycle.py').is_file()
        assert env['WEBUI_INSTALLED_QUALIFICATION'] == '1'
        assert 'PYTHONPATH' not in env
        assert 'OVERSTORY_AUTH_MODE' not in env
        assert check is True
        assert timeout == 180
        if exit_code:
            raise subprocess.CalledProcessError(exit_code, command)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(run_installed.subprocess, 'run', run)
    if exit_code:
        with pytest.raises(subprocess.CalledProcessError) as failure:
            run_installed.main()
        assert failure.value.returncode == exit_code
        assert not (output / 'result.json').exists()
    else:
        run_installed.main()
        receipt = json.loads((output / 'result.json').read_text())
        assert receipt['protocol_tests'] == 'passed'
        assert receipt['browser'] == 'not run'
        assert 'synthetic loopback issuer only' in receipt['acceptance']
    assert len(observed) == 1


@pytest.mark.parametrize('opt_in', [False, True])
def test_collection_and_explicit_missing_prerequisites(tmp_path, opt_in):
    """The exact two-file PR selection must collect skips, not exit with no tests."""
    source = Path(__file__).parent
    for name in ('test_composed_modes.py', 'test_oidc_lifecycle.py'):
        shutil.copyfile(source / name, tmp_path / name)
    (tmp_path / 'conftest.py').write_text(
        'import sys\n'
        'class RejectCandidateImports:\n'
        '    def find_spec(self, fullname, path=None, target=None):\n'
        '        if fullname.split(".")[0] in '
        '{"overstory", "arbora", "cryptography", "fastapi", "httpx", "joserfc"}:\n'
        '            raise AssertionError("Unexpected candidate import: " + fullname)\n'
        'sys.meta_path.insert(0, RejectCandidateImports())\n'
    )
    environment = dict(os.environ)
    environment.pop('WEBUI_INSTALLED_QUALIFICATION', None)
    if opt_in:
        environment['WEBUI_INSTALLED_QUALIFICATION'] = '1'
    environment.pop('PYTHONPATH', None)
    environment['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
    result = subprocess.run(
        [
            sys.executable,
            '-m',
            'pytest',
            '-q',
            'test_composed_modes.py',
            'test_oidc_lifecycle.py',
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if opt_in:
        assert result.returncode == 1, result.stdout + result.stderr
        assert 'Unexpected candidate import:' in result.stdout
        assert 'skipped' not in result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert '7 skipped' in result.stdout
