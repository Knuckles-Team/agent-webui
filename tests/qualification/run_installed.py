"""Run qualification outside source trees using an explicitly selected environment."""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


def wait_ready(process, ready):
    deadline = time.monotonic() + 45
    while not ready.is_file():
        if process.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError('Loopback fixture failed; inspect server.log')
        time.sleep(0.1)


def browser_run(args, folder, output, environment):
    node = shutil.which('node')
    if node is None:
        raise RuntimeError('Node.js and installed Playwright Chromium are required')
    script = Path(__file__).resolve().parents[2] / 'e2e' / 'installed-auth.mjs'
    with (output / 'server.log').open('w') as log:
        process = subprocess.Popen(
            [str(args.python), '-m', 'qualification.serve_browser', str(output)],
            cwd=folder,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_ready(process, output / 'ready.json')
            subprocess.run(
                [node, str(script), str(output), args.browser],
                check=True,
                env=environment,
                timeout=180,
            )
        finally:
            (output / 'control.json').write_text('{"stop":true}')
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--python',
        required=True,
        type=Path,
        help='Installed candidate environment interpreter',
    )
    parser.add_argument(
        '--output',
        required=True,
        type=Path,
        help='Directory for local logs and screenshots',
    )
    parser.add_argument('--browser', choices=['lifecycle', 'baseline', 'smoke'])
    args = parser.parse_args()
    args.python = args.python.absolute()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='webui-qualification-') as temporary:
        folder = Path(temporary)
        shutil.copytree(
            Path(__file__).parent,
            folder / 'qualification',
            ignore=shutil.ignore_patterns('__pycache__'),
        )
        environment = {
            'PATH': os.defpath,
            'HOME': os.environ.get('HOME', str(folder)),
            'XDG_CONFIG_HOME': str(folder / 'config'),
            'WEBUI_INSTALLED_QUALIFICATION': '1',
            'OVERSTORY_ACCESS_LOG_POLICY': 'disabled',
        }
        subprocess.run(
            [str(args.python), '-m', 'pytest', '-q', 'qualification'],
            cwd=folder,
            env=environment,
            check=True,
            timeout=180,
        )
        if args.browser:
            browser_run(args, folder, output, environment)
        (output / 'result.json').write_text(
            json.dumps(
                {
                    'protocol_tests': 'passed',
                    'browser': args.browser or 'not run',
                    'acceptance': 'installed candidate with synthetic loopback issuer only',
                },
                indent=2,
            )
            + '\n'
        )


if __name__ == '__main__':
    main()
