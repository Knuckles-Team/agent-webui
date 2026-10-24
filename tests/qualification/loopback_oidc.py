"""Disposable loopback protocol qualification; no live provider acceptance."""

import base64
import hashlib
import html
import json
import secrets
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit

from joserfc import jwt
from joserfc.jwk import RSAKey


@contextmanager
def running_issuer():
    key = RSAKey.generate_key(
        2048, parameters={'kid': 'fixture', 'alg': 'RS256', 'use': 'sig'}
    )
    state = SimpleNamespace(
        codes={},
        refreshes=0,
        reject_refresh=False,
        require_interaction=False,
        client_secret=secrets.token_urlsafe(24),
        refresh_token=secrets.token_urlsafe(24),
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, data, status=200):
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        def redirect(self, location):
            self.send_response(302)
            self.send_header('Location', location)
            self.end_headers()

        def do_GET(self):
            path = urlsplit(self.path)
            if path.path == '/.well-known/openid-configuration':
                self.reply(
                    {
                        'issuer': state.url,
                        'authorization_endpoint': state.url + '/authorize',
                        'token_endpoint': state.url + '/token',
                        'jwks_uri': state.url + '/jwks',
                        'end_session_endpoint': state.url + '/logout',
                    }
                )
            elif path.path == '/jwks':
                self.reply({'keys': [key.as_dict(private=False)]})
            elif path.path == '/authorize':
                query = parse_qs(path.query)
                if state.require_interaction and 'fixture_continue' not in query:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html')
                    self.end_headers()
                    self.wfile.write(
                        (
                            '<a href="'
                            + html.escape(self.path + '&fixture_continue=1', quote=True)
                            + '">Continue as disposable user</a>'
                        ).encode()
                    )
                    return
                assert query['code_challenge_method'] == ['S256']
                code = secrets.token_urlsafe(24)
                state.codes[code] = query
                self.redirect(
                    query['redirect_uri'][0]
                    + '?'
                    + urlencode({'code': code, 'state': query['state'][0]})
                )
            elif path.path == '/logout':
                self.redirect(parse_qs(path.query)['post_logout_redirect_uri'][0])
            else:
                self.reply({}, 404)

        def do_POST(self):
            form = parse_qs(
                self.rfile.read(int(self.headers['Content-Length'])).decode()
            )
            assert form['client_id'] == ['fixture-client']
            assert form['client_secret'] == [state.client_secret]
            if form['grant_type'] == ['authorization_code']:
                query = state.codes.pop(form['code'][0])
                challenge = (
                    base64.urlsafe_b64encode(
                        hashlib.sha256(form['code_verifier'][0].encode()).digest()
                    )
                    .rstrip(b'=')
                    .decode()
                )
                assert query['code_challenge'] == [challenge]
                assert query['redirect_uri'] == form['redirect_uri']
            else:
                assert form['grant_type'] == ['refresh_token']
                assert form['refresh_token'] == [state.refresh_token]
                state.refreshes += 1
                if state.reject_refresh:
                    self.reply({'error': 'invalid_grant'}, 400)
                    return
            now = int(time.time())
            claims = {
                'iss': state.url,
                'aud': 'fixture-audience',
                'sub': 'disposable-user',
                'tenant_id': 'fixture-tenant',
                'email': 'fixture@example.invalid',
                'scope': 'kg:read',
                'iat': now,
                'exp': now + 1200,
            }
            token = jwt.encode({'alg': 'RS256', 'kid': 'fixture'}, claims, key)
            self.reply(
                {
                    'access_token': token,
                    'refresh_token': state.refresh_token,
                    'token_type': 'Bearer',
                    'expires_in': 300,
                }
            )

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    state.url = 'http://127.0.0.1:' + str(server.server_port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
