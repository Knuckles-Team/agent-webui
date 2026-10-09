"""Verify that an agent-webui wheel carries its governed contact API."""

from __future__ import annotations

import argparse
import ast
from pathlib import Path
from zipfile import ZipFile

import tomllib


def _function(module: ast.Module, name: str) -> ast.FunctionDef:
    for node in module.body:
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
        ):
            return node
    raise ValueError(f'{name} is missing')


def _factory_accepts_contact_delivery(module: ast.Module) -> bool:
    factory = _function(module, 'create_agent_web_app')
    arguments = [*factory.args.posonlyargs, *factory.args.args]
    parameter_index = next(
        (
            index
            for index, argument in enumerate(arguments)
            if argument.arg == 'contact_delivery'
        ),
        None,
    )
    if parameter_index is None:
        return False
    default_offset = len(arguments) - len(factory.args.defaults)
    default_index = parameter_index - default_offset
    return (
        default_index >= 0
        and isinstance(factory.args.defaults[default_index], ast.Constant)
        and (factory.args.defaults[default_index].value is None)
    )


def _factory_wires_contact_router(module: ast.Module) -> bool:
    factory = _function(module, 'create_agent_web_app')
    for node in ast.walk(factory):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            continue
        if node.func.id != 'build_contact_router' or len(node.args) != 1:
            continue
        argument = node.args[0]
        if isinstance(argument, ast.Name) and argument.id == 'contact_delivery':
            return True
    return False


def check_wheel(wheel: Path, expected_version: str) -> None:
    metadata_path = f'agent_webui-{expected_version}.dist-info/METADATA'
    required = {
        'agent_webui/contact_delivery.py',
        'agent_webui/server.py',
        metadata_path,
    }
    with ZipFile(wheel) as archive:
        missing = required.difference(archive.namelist())
        if missing:
            raise ValueError(f'wheel is missing required members: {sorted(missing)}')
        metadata = archive.read(metadata_path).decode('utf-8')
        server = ast.parse(archive.read('agent_webui/server.py'))
        contact = ast.parse(archive.read('agent_webui/contact_delivery.py'))

    if f'\nVersion: {expected_version}\n' not in f'\n{metadata}':
        raise ValueError(f'wheel metadata does not declare version {expected_version}')
    _function(contact, 'build_contact_router')
    if not _factory_accepts_contact_delivery(server):
        raise ValueError(
            'create_agent_web_app lacks an optional contact_delivery parameter'
        )
    if not _factory_wires_contact_router(server):
        raise ValueError(
            'create_agent_web_app does not wire contact_delivery to its router'
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wheel', type=Path)
    args = parser.parse_args()
    project = tomllib.loads(Path('pyproject.toml').read_text(encoding='utf-8'))
    expected_version = str(project['project']['version'])
    check_wheel(args.wheel, expected_version)
    print(f'{args.wheel.name}: contact delivery contract {expected_version} verified')


if __name__ == '__main__':
    main()
