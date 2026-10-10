from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / 'scripts' / 'check_tracked_privacy.py'


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location('check_tracked_privacy', SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_team_generic_package_author_is_accepted() -> None:
    gate = _load_gate()
    lines = [
        '[[project.authors]]',
        'name = "Repository Maintainers"',
        'email = "maintainers@knuckles.team"',
    ]
    assert gate._author_metadata_lines(Path('pyproject.toml'), lines) == []


@pytest.mark.parametrize(
    ('name', 'email', 'violation_line'),
    [
        ('Personal Name', 'maintainers@knuckles.team', 2),
        ('Repository Maintainers', 'person@knuckles.team', 3),
        ('Repository Maintainers', 'maintainers@gmail.com', 3),
    ],
)
def test_personal_or_non_team_package_author_is_rejected(
    name: str, email: str, violation_line: int
) -> None:
    gate = _load_gate()
    lines = [
        '[[project.authors]]',
        f'name = "{name}"',
        f'email = "{email}"',
    ]
    assert violation_line in gate._author_metadata_lines(Path('pyproject.toml'), lines)


def test_inline_author_requires_exact_generic_identity() -> None:
    gate = _load_gate()
    accepted = [
        'authors = [{ name = "Repository Maintainers", email = "maintainers@knuckles.team" }]'
    ]
    personal = [
        'authors = [{ name = "Repository Maintainers", email = "person@knuckles.team" }]'
    ]
    assert gate._author_metadata_lines(Path('pyproject.toml'), accepted) == []
    assert gate._author_metadata_lines(Path('pyproject.toml'), personal) == [1]


@pytest.mark.parametrize(
    ('variable', 'value'), [('CI', 'true'), ('CLAUDE_CODE_REMOTE', 'true')]
)
def test_platform_identity_is_never_an_identifier(
    monkeypatch: pytest.MonkeyPatch, variable: str, value: str
) -> None:
    gate = _load_gate()
    for name in ('CI', 'CLAUDE_CODE_REMOTE', 'AGENT_UTILITIES_PRIVACY_IDENTIFIERS'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(variable, value)
    monkeypatch.setenv('USER', 'platform-account')
    assert gate.derive_local_identifiers() == frozenset()


def test_declared_identifiers_apply_on_platform_runners(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gate = _load_gate()
    monkeypatch.setenv('CI', 'true')
    monkeypatch.setenv('AGENT_UTILITIES_PRIVACY_IDENTIFIERS', 'secret-person')
    identifiers = gate.derive_local_identifiers()
    assert identifiers == frozenset({'secret-person'})
    assert gate.classify_line(
        'owner: secret-person', identifiers=identifiers, deployment_doc=False
    )


def test_home_path_is_detected_without_any_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gate = _load_gate()
    monkeypatch.setenv('CI', 'true')
    monkeypatch.delenv('AGENT_UTILITIES_PRIVACY_IDENTIFIERS', raising=False)
    home_path = '/'.join(('', 'home', 'someone', '.cache', 'tool'))
    assert gate.classify_line(
        f'cache = "{home_path}"',
        identifiers=gate.derive_local_identifiers(),
        deployment_doc=False,
    )


# Shared-fix regression: ``_MACHINE_HOST_ID_RE``'s lookbehind did not exclude
# ``-``, so a hyphen-joined requirement ID (``AU-BOUNDARY-R016``) false-
# positived as a machine host alias. Fixed by widening the lookbehind to
# ``(?<![a-z0-9-])`` -- the same one-character fix as pipelines PR #41
# (pipelines_hooks/privacy/patterns.py) and epistemic-graph's local copy
# (D-EG-PRIVACY-R001-FALSEPOS).
def test_hyphenated_requirement_id_is_not_flagged_as_host_id() -> None:
    gate = _load_gate()
    categories = gate.classify_line(
        'see AU-BOUNDARY-R016 for the full requirement text',
        identifiers=frozenset(),
        deployment_doc=False,
    )
    assert 'machine-specific host identifier' not in categories


def test_bare_host_token_is_still_flagged_as_host_id() -> None:
    gate = _load_gate()
    categories = gate.classify_line(
        'reported from ' + 'host' + '123',
        identifiers=frozenset(),
        deployment_doc=False,
    )
    assert 'machine-specific host identifier' in categories
