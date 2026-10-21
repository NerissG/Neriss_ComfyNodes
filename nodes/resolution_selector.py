from __future__ import annotations

import math
from pathlib import Path
from typing import TypedDict

import folder_paths
from aiohttp import web
from comfy_api.latest import io
from server import PromptServer

from ..shared import Err
from ..shared.json_store import load_store, request_json, save_store, store_response
from ..shared.limits import MAX_PRESETS, MAX_TEXT_LENGTH, finite_number

RESOLUTION_PRESET_FILE = "resolution_presets.json"


class ResolutionPreset(TypedDict):
    name: str
    x: int
    y: int


DEFAULT_RESOLUTION_PRESETS: list[ResolutionPreset] = [{"name": "1:1", "x": 1, "y": 1}]


def get_resolution_presets_path() -> Path:
    return Path(folder_paths.get_user_directory()) / "Neriss_ComfyNodes" / RESOLUTION_PRESET_FILE


def normalize_resolution_preset(value: object) -> ResolutionPreset | None:
    if not isinstance(value, dict):
        return None

    name = value.get("name")
    x = value.get("x")
    y = value.get("y")
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_TEXT_LENGTH:
        return None
    if type(x) is not int or type(y) is not int or not 1 <= x <= 100_000 or not 1 <= y <= 100_000:
        return None

    return {"name": name.strip(), "x": x, "y": y}


def normalize_resolution_presets(content: object) -> list[ResolutionPreset] | None:
    if not isinstance(content, dict):
        return None
    presets = content.get("presets")
    if not isinstance(presets, list) or not 1 <= len(presets) <= MAX_PRESETS:
        return None

    normalized: list[ResolutionPreset] = []
    names: set[str] = set()
    for item in presets:
        preset = normalize_resolution_preset(item)
        if preset is None:
            return None
        name = preset["name"]
        if name in names:
            return None
        names.add(name)
        normalized.append(preset)

    return normalized


def default_resolution_presets() -> list[ResolutionPreset]:
    return [{"name": preset["name"], "x": preset["x"], "y": preset["y"]} for preset in DEFAULT_RESOLUTION_PRESETS]


def coerce_int(value: object, default: int, minimum: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return max(minimum, value)
    if isinstance(value, float) and math.isfinite(value):
        return max(minimum, round(value))
    return default


def coerce_float(value: object, default: float, minimum: float) -> float:
    if isinstance(value, bool):
        return default
    number = finite_number(value)
    if number is not None:
        return max(minimum, number)
    return default


SIZING_MODES: list[str] = ["megapixels", "squared"]


def normalize_sizing_mode(value: object) -> str:
    if isinstance(value, str) and value in SIZING_MODES:
        return value
    return "megapixels"


def calculate_resolution(aspect_x: int, aspect_y: int, target_pixels: float, multiple: int) -> tuple[int, int]:
    ratio = aspect_x / aspect_y
    raw_width = math.sqrt(target_pixels * ratio)
    raw_height = raw_width / ratio
    width = max(multiple, round(raw_width / multiple) * multiple)
    height = max(multiple, round(raw_height / multiple) * multiple)
    return width, height


prompt_server = getattr(PromptServer, "instance")  # noqa: B009 - Comfy exposes this singleton dynamically.
routes = getattr(prompt_server, "routes")  # noqa: B009 - Keep dynamic for ty compatibility.


@routes.get("/neriss_comfynodes/resolution/presets")
async def get_resolution_presets(_: web.Request) -> web.Response:
    return store_response(
        load_store(
            get_resolution_presets_path(),
            lambda: {"presets": default_resolution_presets()},
            normalize_resolution_payload,
        )
    )


@routes.post("/neriss_comfynodes/resolution/presets")
async def save_resolution_presets(request: web.Request) -> web.Response:
    content = await request_json(request)
    if isinstance(content, Err):
        return store_response(content, 400)
    presets = normalize_resolution_presets(content.value)
    if presets is None:
        return web.json_response(
            {"error": "Expected object with unique presets containing name, x, and y"},
            status=400,
        )
    if len(presets) == 0:
        return web.json_response({"error": "At least one preset is required"}, status=400)

    result = save_store(
        get_resolution_presets_path(),
        {"presets": presets},
        lambda: {"presets": default_resolution_presets()},
        normalize_resolution_payload,
        request.headers.get("If-Match"),
    )
    return store_response(result)


def normalize_resolution_payload(value: object) -> dict[str, list[ResolutionPreset]] | None:
    presets = normalize_resolution_presets(value)
    return {"presets": presets} if presets is not None else None


class NerissResolutionSelector(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Neriss_ResolutionSelector",
            display_name="🔨 Resolution Selector",
            category="Neriss/Image",
            description=(
                "Select width and height from editable aspect-ratio presets or a custom aspect ratio, "
                "sized by target megapixels or a target square side length."
            ),
            inputs=[
                io.Combo.Input(
                    "preset",
                    options=[""],
                    default="",
                    socketless=True,
                    tooltip=(
                        "Preset label. The frontend supplies the dropdown; execution uses the saved ratio snapshot."
                    ),
                ),
                io.Boolean.Input(
                    "flip",
                    default=False,
                    socketless=True,
                    tooltip="Swap the selected aspect ratio from X:Y to Y:X.",
                ),
                io.Combo.Input(
                    "mode",
                    options=SIZING_MODES,
                    default="megapixels",
                    socketless=True,
                    tooltip=(
                        "megapixels targets total pixels; squared targets a square side length "
                        "(total pixels = squared squared)."
                    ),
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.01,
                    max=64.0,
                    step=0.01,
                    socketless=True,
                    tooltip="Approximate target megapixels before rounding to the selected multiple.",
                ),
                io.Int.Input(
                    "squared",
                    default=1024,
                    min=64,
                    max=16384,
                    step=64,
                    socketless=True,
                    tooltip=(
                        "Square side length in pixels; total pixels = squared squared, "
                        "rounded to the selected multiple."
                    ),
                ),
                io.Int.Input(
                    "multiple",
                    default=16,
                    min=1,
                    max=1024,
                    step=1,
                    socketless=True,
                    tooltip="Round width and height to this multiple.",
                ),
                io.Boolean.Input(
                    "custom",
                    default=False,
                    socketless=True,
                    tooltip="Use aspect_x and aspect_y instead of the selected preset.",
                ),
                io.Int.Input(
                    "aspect_x",
                    default=1,
                    min=1,
                    max=100_000,
                    step=1,
                    socketless=True,
                    tooltip="Custom aspect-ratio width side, used in custom mode.",
                ),
                io.Int.Input(
                    "aspect_y",
                    default=1,
                    min=1,
                    max=100_000,
                    step=1,
                    socketless=True,
                    tooltip="Custom aspect-ratio height side, used in custom mode.",
                ),
                io.Int.Input(
                    "preset_aspect_x",
                    default=1,
                    min=1,
                    max=100_000,
                    step=1,
                    socketless=True,
                    advanced=True,
                    tooltip="Saved snapshot of the selected preset width side.",
                ),
                io.Int.Input(
                    "preset_aspect_y",
                    default=1,
                    min=1,
                    max=100_000,
                    step=1,
                    socketless=True,
                    advanced=True,
                    tooltip="Saved snapshot of the selected preset height side.",
                ),
            ],
            outputs=[io.Int.Output("width", display_name="width"), io.Int.Output("height", display_name="height")],
            search_aliases=["resolution", "aspect ratio", "image size", "width height"],
        )

    @classmethod
    # Validate only this descriptive label; Comfy still validates every numeric input.
    def validate_inputs(cls, preset: object) -> bool | str:  # ty: ignore[invalid-method-override]
        return True if isinstance(preset, str) else "Preset label must be a string."

    @classmethod
    def execute(cls, **kwargs: object) -> io.NodeOutput:
        if kwargs.get("custom") is True:
            aspect_x = coerce_int(kwargs.get("aspect_x"), 1, 1)
            aspect_y = coerce_int(kwargs.get("aspect_y"), 1, 1)
        else:
            aspect_x = coerce_int(kwargs.get("preset_aspect_x"), 0, 1)
            aspect_y = coerce_int(kwargs.get("preset_aspect_y"), 0, 1)
            if aspect_x < 1 or aspect_y < 1:
                return io.NodeOutput(block_execution="Selected resolution preset has no saved aspect-ratio snapshot.")

        if kwargs.get("flip") is True:
            aspect_x, aspect_y = aspect_y, aspect_x

        mode = normalize_sizing_mode(kwargs.get("mode"))
        if mode == "squared":
            target_pixels = float(coerce_int(kwargs.get("squared"), 1024, 64) ** 2)
        else:
            target_pixels = coerce_float(kwargs.get("megapixels"), 1.0, 0.01) * 1_000_000
        multiple = coerce_int(kwargs.get("multiple"), 16, 1)
        width, height = calculate_resolution(aspect_x, aspect_y, target_pixels, multiple)
        return io.NodeOutput(width, height)
