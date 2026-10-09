"""Deprecated alias: ``agent_webui`` is now ``graph_os_webui``.

Temporary compatibility shim for graph-os, which still imports the old name.
Every ``agent_webui.<sub>`` import resolves to the same module object as
``graph_os_webui.<sub>``. Remove once graph-os consumes ``graph_os_webui``
(GRAPHOS-DEPLOY-R005).
"""

from __future__ import annotations

import importlib
import sys
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from importlib.util import spec_from_loader
from types import ModuleType

import graph_os_webui as _target

_OLD = __name__
_NEW = _target.__name__


class _AliasFinder(MetaPathFinder, Loader):
    def find_spec(self, fullname, path, target=None) -> ModuleSpec | None:
        if fullname.startswith(_OLD + '.'):
            return spec_from_loader(fullname, self)
        return None

    def create_module(self, spec: ModuleSpec) -> ModuleType:
        return importlib.import_module(_NEW + spec.name[len(_OLD) :])

    def exec_module(self, module: ModuleType) -> None:
        return None


if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())
