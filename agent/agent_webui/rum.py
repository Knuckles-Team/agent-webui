"""First-party browser RUM (EH-410, operator ruling 2026-09-24).

The dashboard reports its own Core Web Vitals to ``POST /api/rum``: no
third-party SDK, no IP address, no user agent, and a session id that rotates
every UTC day. The route never reads the client address or headers; it
validates a small fixed shape and relays each vital as an OTLP gauge to the
cluster collector (``RUM_OTLP_METRICS_ENDPOINT``, the Alloy OTLP receiver),
which stamps the tenant and remote-writes it to epistemic-graph, where
``rum_*`` series are kept 30 days.

RUM is on by default. A browser whose consent choice is ``denied`` never sends
(``src/lib/rum.ts``); an unset endpoint accepts and drops.
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

#: The vitals the dashboard reports, and the unit of each gauge.
VITALS = {'LCP': 'ms', 'INP': 'ms', 'FCP': 'ms', 'TTFB': 'ms', 'CLS': '1'}
_ENDPOINT_ENV = 'RUM_OTLP_METRICS_ENDPOINT'
_TIMEOUT_S = 5.0


class RumSample(BaseModel):
    """The only client-controlled RUM fields."""

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    session: str = Field(pattern=r'^rum_[a-f0-9]{32}$')
    day: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    route: str = Field(pattern=r'^/[A-Za-z0-9_./:-]{0,127}$')
    vitals: dict[str, float] = Field(max_length=len(VITALS))

    def bounded_vitals(self) -> dict[str, float]:
        """Known vitals with finite, non-negative, sane values only."""
        return {
            name: value
            for name, value in self.vitals.items()
            if name in VITALS and 0 <= value < 600_000
        }


def otlp_metrics(sample: RumSample, now_ns: int) -> dict:
    """The OTLP/HTTP JSON body: one gauge ``rum_<vital>`` per reported vital."""
    attributes = [
        {'key': key, 'value': {'stringValue': value}}
        for key, value in (
            ('route', sample.route),
            ('rum_session', sample.session),
            ('rum_day', sample.day),
        )
    ]
    metrics = [
        {
            'name': f'rum_{name.lower()}',
            'unit': VITALS[name],
            'gauge': {
                'dataPoints': [
                    {
                        'timeUnixNano': str(now_ns),
                        'asDouble': value,
                        'attributes': attributes,
                    }
                ]
            },
        }
        for name, value in sorted(sample.bounded_vitals().items())
    ]
    resource = {
        'attributes': [
            {'key': 'service.name', 'value': {'stringValue': 'graphos-webui'}}
        ]
    }
    return {
        'resourceMetrics': [
            {'resource': resource, 'scopeMetrics': [{'metrics': metrics}]}
        ]
    }


async def _post(endpoint: str, body: dict) -> None:
    import httpx

    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        response = await client.post(endpoint, json=body)
        response.raise_for_status()


def build_rum_router() -> APIRouter:
    """``POST /rum`` -- relay one sample; always ``204`` (never echoes)."""
    router = APIRouter()

    @router.post('/rum', status_code=204)
    async def rum(sample: RumSample) -> Response:
        endpoint = os.environ.get(_ENDPOINT_ENV, '').strip()
        body = otlp_metrics(sample, time.time_ns())
        if endpoint and body['resourceMetrics'][0]['scopeMetrics'][0]['metrics']:
            try:
                await _post(endpoint, body)
            except Exception as exc:
                logger.warning('RUM relay to the collector failed: %s', exc)
        return Response(status_code=204)

    return router


__all__ = ['VITALS', 'RumSample', 'build_rum_router', 'otlp_metrics']
