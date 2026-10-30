"""Analysis snapshots and their ``share.read`` links (EH-421).

Creating a share:

1. replay the listing's signal exactly as the chart does, as of now;
2. have the engine seal an ``analysis_snapshot`` from it (the engine checks the
   key, the flips and every claim's sources, and stamps the notices);
3. store the sealed record as a finance-v1 ``AnalysisSnapshot`` node, created
   only if absent, whose id derives from the digest;
4. issue a tenant-bound ``share.read`` control lease naming the digest.

Reading a share checks the lease (kind, status, expiry), loads the node and
re-seals its draft: the digests must match, or the record is refused as
tampered. The chart behind it is rebuilt as of the snapshot's creation time,
so late or corrected bars never change what the link shows, and the replay's
source revision says whether the data reproduced exactly.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any

from .gateway import EngineGateway, MarketsRefused, MarketsUnavailable

SHARE_KIND = 'share.read'
NODE_PREFIX = 'analysis-snapshot:'
#: The engine bounds a control lease to 24 hours.
MAX_SHARE_HOURS = 24
MS_PER_HOUR = 3_600_000


class ShareNotFound(Exception):
    """No usable share: unknown, another kind, revoked, expired or tampered."""


@dataclass(frozen=True)
class Caller:
    tenant: str
    #: sha256 of the verified actor id; never the raw subject.
    actor_ref: str


def actor_ref(actor_id: str) -> str:
    return 'sha256:' + hashlib.sha256(actor_id.encode()).hexdigest()


def build_draft(
    replay: dict[str, Any],
    spec: dict[str, Any],
    window: dict[str, int],
    layers: list[str],
    claims: list[dict[str, Any]],
    created_at: int,
) -> dict[str, Any]:
    state = replay['state']
    return {
        'key': state['key'],
        'spec': spec,
        'window': window,
        'source_revision': state['source_revision'],
        'as_of': created_at,
        'direction': state.get('direction'),
        'data_status': state['data_status'],
        'last_close': state.get('last_close'),
        'line': state.get('line'),
        'flips': [
            flip
            for flip in replay['current']
            if window['from_open'] <= flip['bar_open']
            and flip['effective_at'] <= window['to_close']
        ],
        'layers': layers,
        'claims': claims,
        'created_at': created_at,
    }


def _node_properties(record: dict[str, Any]) -> dict[str, Any]:
    draft = record['draft']
    return {
        'type': 'AnalysisSnapshot',
        'analysisOf': draft['key']['series']['listing_id'],
        'analysisDigest': record['digest'],
        'record': json.dumps(record, sort_keys=True, separators=(',', ':')),
    }


async def create_share(
    gateway: EngineGateway,
    caller: Caller,
    draft: dict[str, Any],
    now_ms: int,
    hours: int,
) -> dict[str, Any]:
    record = await gateway.market('analysis_snapshot', draft=draft)
    node_id = NODE_PREFIX + record['digest'].removeprefix('sha256:')
    await gateway.create_node(node_id, _node_properties(record))
    lease_id = 'share-' + secrets.token_urlsafe(18)
    expires = now_ms + min(max(hours, 1), MAX_SHARE_HOURS) * MS_PER_HOUR
    answer = await gateway.issue_lease(
        tenant=caller.tenant,
        lease_id=lease_id,
        kind=SHARE_KIND,
        grant={
            'snapshot': node_id,
            'digest': record['digest'],
            'issued_by': caller.actor_ref,
        },
        issued_at_ms=now_ms,
        expires_at_ms=expires,
        hard_expires_at_ms=expires,
        idempotency_key=lease_id,
    )
    if answer.get('outcome') != 'issued':
        raise MarketsUnavailable('The share link could not be issued')
    return {'lease_id': lease_id, 'digest': record['digest'], 'expires_at': expires}


async def _live_lease(
    gateway: EngineGateway, caller: Caller, lease_id: str, now_ms: int
) -> dict[str, Any]:
    lease = await gateway.get_lease(tenant=caller.tenant, lease_id=lease_id)
    usable = (
        lease is not None
        and lease.get('kind') == SHARE_KIND
        and lease.get('status') == 'active'
        and now_ms < int(lease.get('expires_at_ms', 0))
    )
    if not usable or lease is None:
        raise ShareNotFound(lease_id)
    return lease


async def read_share(
    gateway: EngineGateway, caller: Caller, lease_id: str, now_ms: int
) -> tuple[dict[str, Any], dict[str, Any]]:
    """``(lease, verified record)`` or :class:`ShareNotFound`."""

    lease = await _live_lease(gateway, caller, lease_id, now_ms)
    grant = lease.get('grant') or {}
    props = await gateway.node(str(grant.get('snapshot', '')))
    if not props:
        raise ShareNotFound(lease_id)
    record = json.loads(props.get('record') or '{}')
    try:
        resealed = await gateway.market('analysis_snapshot', draft=record.get('draft'))
    except MarketsRefused as error:
        raise ShareNotFound(lease_id) from error
    if resealed != record or record.get('digest') != grant.get('digest'):
        raise ShareNotFound(lease_id)
    return lease, record


async def revoke_share(
    gateway: EngineGateway, caller: Caller, lease_id: str, now_ms: int
) -> bool:
    """Revoke a live share the caller issued; ``False`` when it is not theirs."""

    lease = await _live_lease(gateway, caller, lease_id, now_ms)
    if (lease.get('grant') or {}).get('issued_by') != caller.actor_ref:
        return False
    answer = await gateway.transition_lease(
        tenant=caller.tenant,
        lease_id=lease_id,
        expected_revision=int(lease['revision']),
        to='revoked',
        idempotency_key=f'{lease_id}:revoke:{lease["revision"]}',
    )
    return answer.get('outcome') == 'applied'
