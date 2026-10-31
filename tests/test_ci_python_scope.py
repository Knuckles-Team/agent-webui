"""CI combines the existing mapper's two declared roots, never a new mapper."""

from __future__ import annotations

import configparser
import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
BACKEND = 'agent/overstory/__tests__'
BACKEND_TEST = f'{BACKEND}/test_run_identity.py'
ROOT_TEST = 'tests/test_gate_wrappers.py'


def steps():
    workflow = yaml.safe_load((ROOT / '.github/workflows/ci.yml').read_text())
    return workflow['jobs']['tests']['steps']


def resolve_scope(tmp_path, backend, root, *, fail_root=None):
    """Supply recorded mapper outputs to exercise the workflow aggregation."""
    script = next(step['run'] for step in steps() if step.get('id') == 'pr-test-scope')
    binary = tmp_path / 'uvx'
    binary.write_text(
        '#!/usr/bin/env python3\n'
        'import json, os, pathlib, sys\n'
        'args = sys.argv[1:]\n'
        'root = args[args.index("--tests-root") + 1]\n'
        'with open(os.environ["CALL_LOG"], "a") as log:\n'
        '    log.write(json.dumps(args) + "\\n")\n'
        'if root == os.environ.get("FAIL_ROOT"):\n'
        '    print("mapper failed", file=sys.stderr)\n'
        '    sys.exit(2)\n'
        'print(json.loads(os.environ["MAPPER_OUTPUTS"])[root])\n'
    )
    binary.chmod(0o755)
    output = tmp_path / 'github-output'
    result = subprocess.run(
        ['bash', '-c', script],
        cwd=ROOT,
        env={
            **os.environ,
            'PATH': f'{tmp_path}{os.pathsep}{os.environ["PATH"]}',
            'RUNNER_TEMP': str(tmp_path),
            'GITHUB_OUTPUT': str(output),
            'PRE_COMMIT_FROM_REF': 'published-base',
            'CALL_LOG': str(tmp_path / 'calls'),
            'MAPPER_OUTPUTS': json.dumps({BACKEND: backend, 'tests': root}),
            'FAIL_ROOT': fail_root or '',
        },
        text=True,
        capture_output=True,
        check=False,
    )
    return result, output


def run_selected_tests(tmp_path, scope):
    """Capture pytest arguments without executing a second test suite."""
    script = next(
        step['run'] for step in steps() if step['name'].startswith('Python test suite')
    )
    binary = tmp_path / '.venv' / 'bin' / 'python'
    binary.parent.mkdir(parents=True)
    binary.write_text(
        '#!/usr/bin/env python3\n'
        'import json, pathlib, sys\n'
        'with pathlib.Path("pytest-calls").open("a") as log:\n'
        '    log.write(json.dumps(sys.argv[1:]) + "\\n")\n'
    )
    binary.chmod(0o755)
    result = subprocess.run(
        ['bash', '-c', script],
        cwd=tmp_path,
        env={**os.environ, 'SCOPE': scope},
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    calls = tmp_path / 'pytest-calls'
    return (
        [json.loads(line) for line in calls.read_text().splitlines()]
        if calls.exists()
        else []
    )


@pytest.mark.parametrize(
    ('backend', 'root', 'expected'),
    [
        (BACKEND_TEST, 'NONE', BACKEND_TEST),
        ('NONE', ROOT_TEST, ROOT_TEST),
        (BACKEND_TEST, ROOT_TEST, f'{BACKEND_TEST}\n{ROOT_TEST}'),
        (BACKEND_TEST, BACKEND_TEST, BACKEND_TEST),
        ('FULL', ROOT_TEST, 'FULL'),
        (BACKEND_TEST, 'FULL', 'FULL'),
        ('NONE', 'NONE', 'NONE'),
    ],
)
def test_scope_union_and_precedence(tmp_path, backend, root, expected):
    result, output = resolve_scope(tmp_path, backend, root)
    assert result.returncode == 0, result.stderr
    assert (
        output.read_text()
        == f'scope<<PR_TEST_SCOPE_EOF\n{expected}\nPR_TEST_SCOPE_EOF\n'
    )
    calls = [json.loads(line) for line in (tmp_path / 'calls').read_text().splitlines()]
    assert len(calls) == 2
    assert [args[args.index('--tests-root') + 1] for args in calls] == [
        BACKEND,
        'tests',
    ]
    for args in calls:
        assert args[args.index('--src-root') + 1] == 'agent/overstory'
        assert args[args.index('--base-ref') + 1] == 'published-base'
    assert (ROOT / BACKEND_TEST).is_file()
    assert (ROOT / ROOT_TEST).is_file()
    pytest_calls = run_selected_tests(tmp_path, expected)
    if expected == 'NONE':
        assert pytest_calls == []
    else:
        paths = [] if expected == 'FULL' else expected.splitlines()
        assert pytest_calls == [
            [
                '-m',
                'pytest',
                *paths,
                '-q',
                '--tb=short',
                '-m',
                'not slow',
                '--timeout=60',
            ]
        ]


@pytest.mark.parametrize('failed', [BACKEND, 'tests'])
def test_mapper_failure_is_not_converted_to_none(tmp_path, failed):
    result, output = resolve_scope(tmp_path, BACKEND_TEST, ROOT_TEST, fail_root=failed)
    assert result.returncode == 2
    assert not output.exists()


def test_full_collection_uses_pytest_declared_roots_and_one_invocation():
    config = configparser.ConfigParser()
    config.read(ROOT / 'pytest.ini')
    assert config['pytest']['testpaths'].split() == [BACKEND, 'tests']
    full = next(
        step['run'] for step in steps() if step['name'].startswith('Full test suite')
    )
    subset = next(
        step['run'] for step in steps() if step['name'].startswith('Python test suite')
    )
    command = '.venv/bin/python -m pytest -q --tb=short -m "not slow" --timeout=60'
    assert full.count(command) == 1
    assert subset.count(command) == 1
    assert 'python -m pytest tests ' not in full + subset
    assert 'pytest "${affected_tests[@]}"' in subset
    assert 'if [ "$SCOPE" = "NONE" ]; then' in subset
