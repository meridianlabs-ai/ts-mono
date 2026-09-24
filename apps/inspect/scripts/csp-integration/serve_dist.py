"""Run an `inspect` CLI command with the viewer dist swapped for another build.

Usage: python serve_dist.py <dist_dir> <inspect args...>

`inspect view` and `inspect view bundle` read the viewer from the installed
package; this points both at `<dist_dir>` in-process, so a local ts-mono
build can be tested against an inspect_ai checkout without touching its
committed `_view/dist`.
"""

import sys
from pathlib import Path

import inspect_ai._view._dist as dist_module
import inspect_ai._view.fastapi_server as server_module
import inspect_ai.log._bundle as bundle_module
from inspect_ai._cli.main import main

dist = Path(sys.argv[1]).resolve()
dist_module.resolve_dist_directory = lambda: dist
server_module.resolve_dist_directory = lambda: dist
bundle_module._dist_dir = lambda: str(dist)

sys.argv = ["inspect", *sys.argv[2:]]
main()
