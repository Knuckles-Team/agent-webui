"""Loopback-only host for installed-artifact browser qualification."""

import argparse
import json
import socket
import threading
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace

import uvicorn
from cryptography.fernet import Fernet

from .loopback_oidc import running_issuer


def build_app(issuer, origin, clock):
    from overstory import host, oidc_session
    from overstory.server import create_agent_web_app
    from arbora.webui_host.session_boundary import identity_factory_kwargs
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    settings = oidc_session.OIDCSettings(
        client_id='fixture-client',
        client_secret=issuer.client_secret,
        issuer=issuer.url,
        redirect_uri=origin + '/auth/callback',
        scope='openid',
        session_key=Fernet.generate_key().decode(),
    )
    oidc_session.load_settings = lambda: settings
    qualified_clock = ModuleType('qualification_clock')
    qualified_clock.__dict__.update(
        time=lambda: time.time() + clock.offset,
        monotonic=time.monotonic,
    )
    oidc_session.time = qualified_clock
    values = {
        'auth_jwt_jwks_uri': issuer.url + '/jwks',
        'auth_jwt_issuer': issuer.url,
        'auth_jwt_audience': 'fixture-audience',
        'allowed_hosts': '127.0.0.1,localhost',
        'allowed_origins': origin,
        'gateway_rate_limit': 0,
        'gateway_rate_burst': 0,
    }
    for field, value in values.items():
        setattr(host.config, field, value)

    def compose(app):
        @app.get('/api/lifecycle')
        def identity():
            actor = host.current_actor()
            return {
                'subject': actor.actor_id,
                'authenticated': actor.authenticated,
                'tenant': actor.tenant_id,
            }

    return create_agent_web_app(
        Agent(TestModel()),
        {'get_path': lambda value: value},
        listener_host='127.0.0.1',
        application_composer=compose,
        **identity_factory_kwargs('oidc', None, factory=create_agent_web_app),
    )


def watch_control(server, thread, control, issuer, clock):
    deadline = time.monotonic() + 30
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError('Qualification server did not start')
        time.sleep(0.05)
    yield
    while thread.is_alive():
        try:
            data = json.loads(control.read_text())
        except (json.JSONDecodeError, FileNotFoundError):
            time.sleep(0.05)
            continue
        clock.offset = data.get('offset', 0)
        issuer.reject_refresh = data.get('reject_refresh', False)
        if data.get('stop'):
            break
        time.sleep(0.05)


def serve(directory):
    control, ready = directory / 'control.json', directory / 'ready.json'
    control.write_text(json.dumps({'offset': 0, 'reject_refresh': False}))
    with running_issuer() as issuer, socket.socket() as sock:
        issuer.require_interaction = True
        sock.bind(('127.0.0.1', 0))
        origin = f'http://127.0.0.1:{sock.getsockname()[1]}'
        clock = SimpleNamespace(offset=0)
        server = uvicorn.Server(
            uvicorn.Config(
                build_app(issuer, origin, clock),
                log_level='warning',
                access_log=False,
            )
        )
        thread = threading.Thread(
            target=lambda: server.run(sockets=[sock]), daemon=True
        )
        thread.start()
        try:
            watcher = watch_control(server, thread, control, issuer, clock)
            next(watcher)
            ready.write_text(json.dumps({'origin': origin, 'issuer': issuer.url}))
            for _ in watcher:
                pass
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            ready.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    serve(parser.parse_args().directory)
