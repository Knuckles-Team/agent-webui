from __future__ import annotations

"""BUG-012 (GOC-27-W01/W04) proof: `get_github_prs`/`get_gitlab_mrs`
(`agent_webui/api_extensions.py`) now map every field the WebUI's
`EcosystemView.tsx` interfaces/schemas depend on.

Two concrete backend mismatches this covers (see the BUG-012 fixture
manifest in `agent-utilities` `tests/fixtures/enterprise/github_gitlab/
MANIFEST.md` for the real captured payloads these mock responses mirror):

1. `run_number` was silently dropped from the GitHub Actions run mapping
   even though the real API always returns it -- `wf.run_number` on the
   frontend always rendered blank.
2. Neither PR nor MR rows exposed a `web_url`, even though both GitHub and
   GitLab's raw payloads always carry one -- the frontend had nowhere to
   link the source record from.

These call the route handler functions directly (not through `TestClient`)
because they are pure `_call_mcp_tool` field-mapping logic, not an
authorization-layer concern -- `test_security_boundaries.py` already covers
`/api/enhanced/ecosystem/*`'s auth classification separately.
"""

import asyncio
from unittest.mock import AsyncMock, patch

from agent_webui.api_extensions import get_github_prs, get_gitlab_mrs


class TestGithubPrsFieldMapping:
    def test_run_number_and_web_url_are_mapped(self):
        github_pulls_response = {
            'status': 200,
            'data': [
                {
                    'number': 1,
                    'title': 'Operator UI for the ontology system',
                    'state': 'closed',
                    'merged_at': '2026-06-09T12:34:20Z',
                    'user': {'login': 'Knucklessg1'},
                    'head': {'ref': 'feat/ontology-operator-ui'},
                    'html_url': 'https://github.com/Knuckles-Team/agent-webui/pull/1',
                }
            ],
        }
        github_runs_response = {
            'status': 200,
            'data': {
                'workflow_runs': [
                    {
                        'id': 31969737553,
                        'run_number': 5,
                        'name': 'Release',
                        'status': 'completed',
                        'conclusion': 'failure',
                        'html_url': 'https://github.com/Knuckles-Team/agent-webui/actions/runs/31969737553',
                    }
                ]
            },
        }

        async def fake_call(server: str, tool: str, _args: dict) -> dict:
            if tool == 'github_pulls':
                return github_pulls_response
            if tool == 'github_actions':
                return github_runs_response
            raise AssertionError(f'unexpected tool {tool}')

        with patch(
            'agent_webui.api_extensions._call_mcp_tool',
            new=AsyncMock(side_effect=fake_call),
        ):
            body = asyncio.run(get_github_prs(repo='Knuckles-Team/agent-webui'))

        assert body['status'] == 'success'

        assert len(body['prs']) == 1
        pr = body['prs'][0]
        assert pr['id'] == 1
        # `_public_external_result` runs every delegated result through
        # `agent_utilities.security.persistence_privacy.sanitize_for_persistence`,
        # which redacts values under an `author` key that look like a
        # person's name -- a real, separate (pre-existing, not BUG-012's
        # shape mismatch) effect on this same field worth flagging: the
        # WebUI's `GithubPr.author` types as `string | null` but the actual
        # rendered value can be the literal string `[REDACTED_PERSON]`
        # rather than the real login. Assert the redaction marker rather
        # than the raw login to match real behavior, not a guess.
        assert pr['author'] == '[REDACTED_PERSON]'
        assert pr['branch'] == 'feat/ontology-operator-ui'
        # The field the WebUI's `GithubPr` interface now models. Its VALUE
        # is redacted for the same reason `author` is -- `_LOCATION_FIELDS`
        # in the shared privacy sanitizer blanket-redacts any field
        # literally named `web_url`/`html_url`/`url`, including a genuinely
        # public source link. Resolving that is `GOC-27-W06` (security
        # review) scope, not this fix's; `EcosystemView.tsx`'s
        # `isRenderableUrl` guard is the corresponding WebUI-side mitigation
        # -- it only renders an `<a href>` when the value looks like a real
        # URL, so this redaction placeholder never becomes a broken link.
        assert pr['web_url'] == '[REDACTED_LOCATION]'
        # `checks` must never appear -- there is no data source for it and
        # the WebUI no longer expects it (BUG-012).
        assert 'checks' not in pr

        assert len(body['workflows']) == 1
        run = body['workflows'][0]
        # The concrete field BUG-012 found silently dropped end-to-end.
        assert run['run_number'] == 5
        assert run['name'] == 'Release'
        assert run['conclusion'] == 'failure'

    def test_missing_repo_selector_yields_needs_input_not_all_repositories(
        self, monkeypatch
    ):
        """BD-012: "a missing selector is a typed validation error, not
        'all repositories'." No `repo` argument and no `GITHUB_REPO` env ->
        the endpoint must say so explicitly, never silently fan out."""
        monkeypatch.delenv('GITHUB_REPO', raising=False)

        body = asyncio.run(get_github_prs(repo=None))

        assert body['status'] == 'needs_input'
        assert body['prs'] == []
        assert body['workflows'] == []


class TestGitlabMrsFieldMapping:
    def test_project_id_and_web_url_are_mapped(self):
        gitlab_mrs_response = {
            'status': 200,
            'data': [
                {
                    'iid': 250339,
                    'project_id': 278964,
                    'title': 'Document save_ tool action-fold exception',
                    'author': {'username': 'adruid'},
                    'target_branch': 'master',
                    'state': 'opened',
                    'web_url': 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/250339',
                }
            ],
        }
        gitlab_pipelines_response = {'status': 200, 'data': []}

        async def fake_call(server: str, tool: str, args: dict) -> dict:
            assert tool == 'api_request'
            endpoint = args.get('endpoint', '')
            if endpoint.startswith('/merge_requests'):
                return gitlab_mrs_response
            if '/pipelines' in endpoint:
                return gitlab_pipelines_response
            raise AssertionError(f'unexpected endpoint {endpoint}')

        with patch(
            'agent_webui.api_extensions._call_mcp_tool',
            new=AsyncMock(side_effect=fake_call),
        ):
            body = asyncio.run(get_gitlab_mrs())

        assert body['status'] == 'success'
        assert len(body['mrs']) == 1
        mr = body['mrs'][0]
        assert mr['id'] == 250339
        assert mr['project_id'] == 278964
        # See the matching comment in `TestGithubPrsFieldMapping` -- the
        # privacy sanitizer redacts `author` regardless of provider.
        assert mr['author'] == '[REDACTED_PERSON]'
        # Same pre-existing `_LOCATION_FIELDS` redaction as the GitHub PR
        # case above -- this field already existed in `get_gitlab_mrs`
        # before BUG-012 and was already silently corrupted this way.
        assert mr['web_url'] == '[REDACTED_LOCATION]'
