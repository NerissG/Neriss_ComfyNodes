"""Load the real neighboring ComfyUI once, with CPU execution and isolated routes."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
# Comfy's top-level nodes module must precede the nodepack's nodes directory.
sys.path.insert(0, str(ROOT.parent.parent))
sys.path.insert(1, str(ROOT.parent))

from aiohttp import web  # noqa: E402
from comfy.cli_args import args  # noqa: E402

args.cpu = True
import execution  # noqa: E402, F401 - shared real prompt validator for tests
from server import PromptServer  # noqa: E402

with patch.object(PromptServer, "instance", SimpleNamespace(routes=web.RouteTableDef()), create=True):
    package = importlib.import_module(ROOT.name)
    moss = importlib.import_module(f"{ROOT.name}.nodes.moss_prompt_editor")
    ideogram = importlib.import_module(f"{ROOT.name}.nodes.image_editor")
    resolution = importlib.import_module(f"{ROOT.name}.nodes.resolution_selector")
    resize = importlib.import_module(f"{ROOT.name}.nodes.image_resize_megapixels")
    layout = importlib.import_module(f"{ROOT.name}.shared.layout_editor")
    ui_settings = importlib.import_module(f"{ROOT.name}.shared.ui_settings")
    limits = importlib.import_module(f"{ROOT.name}.shared.limits")
