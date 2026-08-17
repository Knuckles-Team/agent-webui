"""GOC-60-W06 (E7): skill/workflow classification must derive from the KG's
own ``CallableResource.resource_type`` truth (``AGENT_SKILL`` vs
``WorkflowDefinition``), never from filesystem path membership.

Failing-first: before the fix, ``list_all_tools`` (``api_extensions.py``)
decided the "Agent Skills" vs "Skill Workflows" bucket purely from
``'workflows' in p.parts`` (line 1779) — the KG's own resource-type truth
(``kg_adapter.get_skills`` / ``resource_type='AGENT_SKILL'`` vs a separate
``WorkflowDefinition`` node) was never consulted, so a runnable skill that
happens to live under a ``workflows`` directory renders as describe-only,
and a describe-only workflow that lives outside one renders as runnable.
This test constructs exactly that mismatch on disk and proves the KG type,
not the path, decides the bucket. It also proves a skill with NO matching
KG node is reported as unclassified rather than silently guessed, and that
a KG-unreachable response says so explicitly instead of falling back to
path-derived classification.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def _patched_engine(engine):
    return patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=engine,
    )


def _patched_skills_root(root: Path):
    return patch(
        'agent_webui.api_extensions.get_skills_packages_dir',
        return_value=root,
    )


@pytest.fixture
def mock_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    return engine


def run(coro):
    return asyncio.run(coro)


def _write_skill_md(path: Path, *, name: str, domain: str, tags: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f'---\n'
        f'name: {name}\n'
        f'domain: {domain}\n'
        f'tags: {tags}\n'
        f'description: test fixture skill\n'
        f'---\n'
        f'# {name}\n',
        encoding='utf-8',
    )


def _skills_fixture(tmp_path: Path) -> Path:
    root = tmp_path / 'skills'
    univ = root / 'universal-skills' / 'universal_skills'

    # Lives under a literal `workflows` PATH segment -- the OLD path-only
    # signal would bucket this as a "Skill Workflow". The KG says it is a
    # runnable CallableResource(AGENT_SKILL): the fix must trust the KG.
    _write_skill_md(
        univ / 'workflows' / 'path-says-workflow-kg-says-skill' / 'SKILL.md',
        name='path-says-workflow-kg-says-skill',
        domain='testing',
        tags='[alpha, beta]',
    )

    # Lives OUTSIDE any `workflows` path segment -- the OLD signal would
    # bucket this as an "Agent Skill". The KG says it is only a describe-only
    # WorkflowDefinition: the fix must trust the KG, not the absence of the
    # path token.
    _write_skill_md(
        univ / 'finance' / 'path-says-skill-kg-says-workflow' / 'SKILL.md',
        name='path-says-skill-kg-says-workflow',
        domain='finance',
        tags='[gamma]',
    )

    # Present on disk but absent from the KG entirely -- must be reported as
    # unclassified, never silently defaulted into either bucket.
    _write_skill_md(
        univ / 'ops' / 'never-ingested' / 'SKILL.md',
        name='never-ingested',
        domain='ops',
        tags='[]',
    )

    return root


def _cypher_side_effect(query: str, *_args, **_kwargs):
    if 'CallableResource' in query and 'AGENT_SKILL' in query:
        return [{'name': 'path-says-workflow-kg-says-skill'}]
    if 'WorkflowDefinition' in query:
        return [{'name': 'path-says-skill-kg-says-workflow'}]
    # Preference/toggle-state lookups and anything else default to "no row".
    return []


def test_skill_classification_uses_kg_type_not_path(mock_engine, tmp_path):
    from agent_webui.api_extensions import list_all_tools

    skills_root = _skills_fixture(tmp_path)
    mock_engine.query_cypher = MagicMock(side_effect=_cypher_side_effect)

    with _patched_engine(mock_engine), _patched_skills_root(skills_root):
        result = run(list_all_tools())

    skill_names = {s['name']: s for s in result['skills']}
    workflow_names = {w['name']: w for w in result['skill_workflows']}

    # The KG said AGENT_SKILL -> must render as a runnable Agent Skill,
    # regardless of the literal `workflows` path segment.
    assert 'path-says-workflow-kg-says-skill' in skill_names, (
        'KG-typed AGENT_SKILL must be classified as a runnable skill even '
        'when its filesystem path contains a `workflows` segment '
        f'(got skills={list(skill_names)}, workflows={list(workflow_names)})'
    )
    assert 'path-says-workflow-kg-says-skill' not in workflow_names
    assert skill_names['path-says-workflow-kg-says-skill']['runnable'] is True
    assert (
        skill_names['path-says-workflow-kg-says-skill']['resource_type']
        == 'AGENT_SKILL'
    )
    # domain/tags parsed from frontmatter must survive onto the payload.
    assert skill_names['path-says-workflow-kg-says-skill']['domain'] == 'testing'
    assert skill_names['path-says-workflow-kg-says-skill']['tags'] == [
        'alpha',
        'beta',
    ]

    # The converse: KG said WorkflowDefinition (describe-only) -> must NOT
    # render as a runnable Agent Skill just because its path lacks the
    # `workflows` token.
    assert 'path-says-skill-kg-says-workflow' in workflow_names, (
        'KG-typed WorkflowDefinition must be classified as describe-only '
        'even when its filesystem path has no `workflows` segment '
        f'(got skills={list(skill_names)}, workflows={list(workflow_names)})'
    )
    assert 'path-says-skill-kg-says-workflow' not in skill_names
    assert workflow_names['path-says-skill-kg-says-workflow']['runnable'] is False
    assert (
        workflow_names['path-says-skill-kg-says-workflow']['resource_type']
        == 'WORKFLOW_DEFINITION'
    )


def test_skill_absent_from_kg_is_reported_unclassified_not_guessed(
    mock_engine, tmp_path
):
    from agent_webui.api_extensions import list_all_tools

    skills_root = _skills_fixture(tmp_path)
    mock_engine.query_cypher = MagicMock(side_effect=_cypher_side_effect)

    with _patched_engine(mock_engine), _patched_skills_root(skills_root):
        result = run(list_all_tools())

    skill_names = {s['name'] for s in result['skills']}
    workflow_names = {w['name'] for w in result['skill_workflows']}
    unclassified_names = {u['name']: u for u in result['skill_unclassified']}

    assert 'never-ingested' not in skill_names
    assert 'never-ingested' not in workflow_names
    assert 'never-ingested' in unclassified_names
    assert unclassified_names['never-ingested']['runnable'] is False
    assert unclassified_names['never-ingested']['kg_classified'] is False


def test_skill_classification_summary_reconciles_filesystem_vs_kg(
    mock_engine, tmp_path
):
    from agent_webui.api_extensions import list_all_tools

    skills_root = _skills_fixture(tmp_path)
    mock_engine.query_cypher = MagicMock(side_effect=_cypher_side_effect)

    with _patched_engine(mock_engine), _patched_skills_root(skills_root):
        result = run(list_all_tools())

    summary = result['skill_classification']
    assert summary['kg_reachable'] is True
    assert summary['filesystem_skill_md_count'] == 3
    assert summary['kg_agent_skill_count'] == 1
    assert summary['kg_workflow_definition_count'] == 1
    assert summary['runnable_count'] == 1
    assert summary['describe_only_count'] == 1
    assert summary['unclassified_count'] == 1


def test_skill_classification_never_falls_back_to_path_when_kg_unreachable(
    mock_engine, tmp_path
):
    """If the KG cannot be queried, the surface must say so explicitly --
    it must NOT silently degrade to the old path-based heuristic (that would
    make a KG outage indistinguishable from a healthy, KG-verified answer)."""
    from agent_webui.api_extensions import list_all_tools

    skills_root = _skills_fixture(tmp_path)

    def _raise(*_args, **_kwargs):
        raise RuntimeError('engine unreachable')

    mock_engine.query_cypher = MagicMock(side_effect=_raise)

    with _patched_engine(mock_engine), _patched_skills_root(skills_root):
        result = run(list_all_tools())

    summary = result['skill_classification']
    assert summary['kg_reachable'] is False

    # Every discovered file must be reported, and NONE may be classified as
    # runnable purely because a query failed -- that would be exactly the
    # silent path-based fallback this fix removes.
    all_ids = {s['id'] for s in result['skills']}
    all_ids |= {w['id'] for w in result['skill_workflows']}
    assert not all_ids, (
        'no item may be bucketed as a runnable skill or a workflow while '
        f'the KG is unreachable; got skills/workflows ids={all_ids}'
    )
    unclassified_names = {u['name'] for u in result['skill_unclassified']}
    assert unclassified_names == {
        'path-says-workflow-kg-says-skill',
        'path-says-skill-kg-says-workflow',
        'never-ingested',
    }


class TestListSkillsUsesKgTypeNotPath:
    """BUG-024, second live instance: `GET /api/enhanced/skills`
    (``list_skills``, consumed by ``KnowledgeView.tsx``) had its own,
    separate ``'workflows' not in p.parts`` filesystem-path guess -- fixing
    `list_all_tools` (`/tools`, covered above) never touched this route.
    ``list_skills`` delegates its classification to
    ``_classify_universal_skills_from_kg``, which is exercised directly here
    so the fixture never needs to defeat that route's `is_testing`
    real-filesystem guard.
    """

    def test_agent_skill_under_a_workflows_path_segment_is_still_a_skill(
        self, tmp_path
    ):
        from agent_webui.api_extensions import _classify_universal_skills_from_kg

        skills_root = _skills_fixture(tmp_path)
        univ_dir = skills_root / 'universal-skills' / 'universal_skills'
        kg_index = {
            'agent_skill_names': {'path-says-workflow-kg-says-skill'},
            'workflow_def_names': {'path-says-skill-kg-says-workflow'},
            'kg_reachable': True,
        }

        result = run(_classify_universal_skills_from_kg(univ_dir, kg_index))

        names = {s['name'] for s in result}
        assert names == {'path-says-workflow-kg-says-skill'}, (
            'must trust the KG resource_type, not the literal `workflows` '
            f'path segment or its absence (got {names})'
        )

    def test_kg_unreachable_never_falls_back_to_the_path_guess(self, tmp_path):
        from agent_webui.api_extensions import _classify_universal_skills_from_kg

        skills_root = _skills_fixture(tmp_path)
        univ_dir = skills_root / 'universal-skills' / 'universal_skills'
        kg_index = {
            'agent_skill_names': {'path-says-workflow-kg-says-skill'},
            'workflow_def_names': {'path-says-skill-kg-says-workflow'},
            'kg_reachable': False,
        }

        result = run(_classify_universal_skills_from_kg(univ_dir, kg_index))

        assert result == [], (
            'a KG-unreachable response must not silently degrade to the old '
            f'path-based heuristic; got {[s["name"] for s in result]}'
        )
