"""The verified caller of a Markets request."""

from __future__ import annotations

from fastapi import HTTPException

from .snapshots import Caller, actor_ref


def verified_caller() -> Caller:
    """The caller's tenant and a digest of their actor id, from the ambient
    verified ``GraphSession``; 401 when there is no tenant-bound session."""

    from agent_utilities.knowledge_graph.core.session import current_session

    session = current_session()
    tenant = str(getattr(session, 'tenant', '') or '').strip() if session else ''
    if not tenant:
        raise HTTPException(
            status_code=401, detail='A verified tenant session is required'
        )
    actor = getattr(session, 'actor', None)
    actor_id = str(getattr(actor, 'actor_id', '') or '')
    return Caller(tenant=tenant, actor_ref=actor_ref(actor_id or f'tenant:{tenant}'))
