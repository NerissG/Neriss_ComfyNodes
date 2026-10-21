"""Model-independent layout state, coordinates, image rendering, and editor assets."""

from __future__ import annotations

import asyncio
import io as byte_io
import json
import math
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal, TypeAlias

import folder_paths
import torch
from aiohttp import BodyPartReader, web
from comfy_api.latest import io
from PIL import Image, ImageDraw, ImageOps
from server import PromptServer

from . import AppError, Err, Ok, Result, editor_errors
from .json_store import load_store, parse_json, request_json, save_store, store_response
from .limits import (
    MAX_COLORS,
    MAX_REGIONS,
    MAX_SAFE_INTEGER,
    MAX_TAGS,
    MAX_TEXT_LENGTH,
    configured_limit,
    finite_number,
    image_budget,
)
from .ui_settings import register_ui_settings_routes

BBox: TypeAlias = tuple[float, float, float, float]
PixelBBox: TypeAlias = tuple[int, int, int, int]
DEFAULT_STYLE: dict[str, object] = {
    "mode": "art",
    "aesthetics": "premium, clean, coherent composition",
    "lighting": "soft studio lighting with readable contrast",
    "medium": "graphic_design",
    "art_style": "modern editorial layout",
    "photo": "photograph",
    "color_palette": [],
}
DEFAULT_STATE: dict[str, object] = {
    "version": 1,
    "width": 1024,
    "height": 1024,
    "high_level_description": "",
    "background": "Dark gray design canvas with a subtle grid.",
    "style_description": DEFAULT_STYLE,
    "moss_meta": [],
    "elements": [],
    "reference_image_path": None,
    "reference_image_fit": "stretch",
}
REFERENCE_IMAGE_DIR = Path("Neriss_ComfyNodes") / "reference_images"
_BBOX_PRETTY = re.compile(r'"bbox": \[\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\s*\]')


@dataclass(frozen=True)
class LayoutRegion:
    kind: Literal["obj", "text"]
    bbox: BBox | None
    caption: str
    text: str = ""
    palette: tuple[str, ...] = ()
    label: str | None = None


@dataclass(frozen=True)
class EditorLayout:
    state: dict[str, object]
    width: int
    height: int
    regions: list[LayoutRegion]
    reference_image: torch.Tensor | None


def parse_json_object(value: str, label: str) -> Result[dict[str, object], AppError]:
    result = parse_json(value)
    if isinstance(result, Err):
        return Err(editor_errors.runtime(f"Could not parse {label} as JSON", cause=result.error))
    parsed = result.value
    if not isinstance(parsed, dict) or not all(isinstance(key, str) for key in parsed):
        return Err(editor_errors.runtime(f"Expected {label} to be a JSON object"))
    return Ok({key: item for key, item in parsed.items() if isinstance(key, str)})


def parse_state(value: str) -> Result[dict[str, object], AppError]:
    if not value.strip():
        return Ok(dict(DEFAULT_STATE))
    parsed = parse_json_object(value, "editor state")
    if isinstance(parsed, Err):
        return parsed
    state = {**DEFAULT_STATE, **parsed.value}
    if type(state["version"]) is not int or state["version"] != 1:
        return Err(editor_errors.runtime("Unsupported editor state version (expected 1)"))
    for key in ("width", "height", "side_step"):
        dimension = state.get(key, 64)
        if type(dimension) is not int or not 1 <= dimension <= MAX_SAFE_INTEGER:
            return Err(editor_errors.runtime(f"Editor {key} must be a positive safe integer"))
    megapixels = finite_number(state.get("megapixels", 1))
    if megapixels is None or megapixels <= 0:
        return Err(editor_errors.runtime("Editor megapixels must be positive and finite"))
    for key in ("high_level_description", "background"):
        text = state[key]
        if not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH:
            return Err(editor_errors.runtime(f"Editor {key} must be a string of at most {MAX_TEXT_LENGTH} characters"))
    style = normalize_editor_style(state["style_description"])
    if style is None:
        return Err(editor_errors.runtime("Invalid editor style"))
    state["style_description"] = style
    meta = state["moss_meta"]
    if (
        not isinstance(meta, list)
        or len(meta) > MAX_TAGS
        or not all(isinstance(tag, str) and len(tag) <= MAX_TEXT_LENGTH for tag in meta)
    ):
        return Err(editor_errors.runtime("Invalid editor metadata tags"))
    for key in ("reference_image_path", "reference_image_name", "selected_region_id"):
        text = state.get(key)
        if text is not None and (not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH):
            return Err(editor_errors.runtime(f"Invalid editor {key}"))
    if state["reference_image_fit"] not in ("stretch", "contain") or state.get("selected_tool", "obj") not in (
        "obj",
        "text",
    ):
        return Err(editor_errors.runtime("Invalid editor image fitting or selected tool"))
    return Ok(state)


def valid_palette(value: object, maximum: int) -> bool:
    return (
        isinstance(value, list)
        and len(value) <= maximum
        and all(isinstance(color, str) and re.fullmatch(r"#[0-9A-F]{6}", color) for color in value)
    )


def normalize_editor_style(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    if not all(isinstance(key, str) for key in value):
        return None
    style = {key: value.get(key, default) for key, default in DEFAULT_STYLE.items()}
    if style["mode"] not in ("art", "photo") or not valid_palette(style["color_palette"], 16):
        return None
    for key in ("aesthetics", "lighting", "medium", "art_style", "photo"):
        text = style[key]
        if not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH:
            return None
    return style


def read_bbox(value: object) -> BBox | None:
    if not isinstance(value, list | tuple) or len(value) != 4:
        return None
    numbers: list[float] = []
    for item in value:
        number = finite_number(item)
        if number is None:
            return None
        numbers.append(number)
    y0, x0, y1, x1 = numbers
    return (y0, x0, y1, x1) if y0 <= y1 and x0 <= x1 else None


def normalize_hex_palette(value: object, maximum: int) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item.upper() for item in value if isinstance(item, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", item))[
        :maximum
    ]


def read_regions(value: object) -> Result[list[LayoutRegion], AppError]:
    if not isinstance(value, list) or len(value) > MAX_REGIONS:
        return Err(editor_errors.runtime("Expected editor elements to be a list"))
    regions: list[LayoutRegion] = []
    ids: dict[str, int] = {}
    region_ids: list[str | None] = []
    parents: list[str | None] = []
    for index, item in enumerate(value, 1):
        if not isinstance(item, dict):
            return Err(editor_errors.runtime(f"Region {index} must be an object"))
        kind = item.get("type")
        bbox = read_bbox(item.get("bbox"))
        caption = item.get("desc", "")
        text = item.get("text", "")
        label = item.get("label")
        region_id = item.get("id")
        parent_id = item.get("parent_id")
        if region_id is not None:
            if not isinstance(region_id, str) or not region_id or len(region_id) > MAX_TEXT_LENGTH or region_id in ids:
                return Err(editor_errors.runtime(f"Region {index} must have a unique string ID"))
            ids[region_id] = index - 1
        if parent_id is not None and (
            not isinstance(parent_id, str) or not parent_id or len(parent_id) > MAX_TEXT_LENGTH
        ):
            return Err(editor_errors.runtime(f"Region {index} parent must be a region ID"))
        region_ids.append(region_id)
        parents.append(parent_id)
        if (kind != "obj" and kind != "text") or (item.get("bbox") is not None and bbox is None):
            return Err(editor_errors.runtime(f"Region {index} has an invalid type or normalized yxyx box"))
        if label is not None and (not isinstance(label, str) or not label.strip() or len(label) > MAX_TEXT_LENGTH):
            return Err(editor_errors.runtime(f"Region {index} label must be a nonempty string"))
        if not isinstance(caption, str) or not isinstance(text, str):
            return Err(editor_errors.runtime(f"Region {index} caption and text must be strings"))
        if max(len(caption), len(text)) > MAX_TEXT_LENGTH or not valid_palette(item.get("color_palette", []), 5):
            return Err(editor_errors.runtime(f"Region {index} has oversized text or an invalid palette"))
        regions.append(
            LayoutRegion(
                "text" if kind == "text" else "obj",
                clamp_bbox(bbox) if bbox is not None else None,
                caption,
                text,
                normalize_hex_palette(item.get("color_palette"), 5),
                label,
            )
        )
    children: dict[str | None, list[int]] = {}
    for index, parent_id in enumerate(parents):
        if parent_id is not None and parent_id not in ids:
            return Err(editor_errors.runtime(f"Region {index + 1} parent does not exist"))
        children.setdefault(parent_id, []).append(index)
    # Compile the editor-only hierarchy to a native, parent-first flat list.
    ordered: list[LayoutRegion] = []
    stack = list(reversed(children.get(None, [])))
    while stack:
        index = stack.pop()
        ordered.append(regions[index])
        region_id = region_ids[index]
        if region_id is not None:
            stack.extend(reversed(children.get(region_id, [])))
    if len(ordered) != len(regions):
        return Err(editor_errors.runtime("Region parents cannot form a cycle"))
    return Ok(ordered)


def pixel_edges(bbox: BBox, width: int, height: int) -> PixelBBox:
    y0, x0, y1, x1 = bbox
    # Match JavaScript Math.round for nonnegative canvas coordinates.
    return (
        math.floor(y0 / 1000 * height + 0.5),
        math.floor(x0 / 1000 * width + 0.5),
        math.floor(y1 / 1000 * height + 0.5),
        math.floor(x1 / 1000 * width + 0.5),
    )


def centralized_bbox(bbox: BBox, width: int, height: int) -> BBox:
    y0, x0, y1, x1 = pixel_edges(bbox, width, height)
    return y0 - height / 2, x0 - width / 2, y1 - height / 2, x1 - width / 2


def import_pixel_bboxes(value: object, width: int, height: int) -> Result[list[LayoutRegion], AppError]:
    if not isinstance(value, list | tuple) or len(value) > MAX_REGIONS:
        return Err(editor_errors.runtime("BBOX input must be a list of [x, y, width, height] pixel boxes"))
    regions: list[LayoutRegion] = []
    for index, item in enumerate(value, 1):
        # Validate xywh numbers before converting to ordered yxyx edges.
        if not isinstance(item, list | tuple) or len(item) != 4:
            return Err(editor_errors.runtime(f"BBOX input {index} must contain four numbers"))
        numbers: list[float] = []
        for number in item:
            parsed_number = finite_number(number)
            if parsed_number is None:
                return Err(editor_errors.runtime(f"BBOX input {index} must contain finite numbers"))
            numbers.append(parsed_number)
        x, y, w, h = numbers
        if w < 0 or h < 0:
            return Err(editor_errors.runtime(f"BBOX input {index} width and height cannot be negative"))
        bbox = ((y / height * 1000), (x / width * 1000), ((y + h) / height * 1000), ((x + w) / width * 1000))
        regions.append(LayoutRegion("obj", clamp_bbox(bbox), f"Region imported from BBOX input {index}."))
    return Ok(regions)


def clamp_pixel(value: float, limit: int) -> float:
    return max(0.0, min(float(limit), value))


def clamp_bbox(bbox: BBox) -> BBox:
    return (
        clamp_pixel(bbox[0], 1000),
        clamp_pixel(bbox[1], 1000),
        clamp_pixel(bbox[2], 1000),
        clamp_pixel(bbox[3], 1000),
    )


def resolve_layout(
    state_json: str,
    width: int | None,
    height: int | None,
    reference_image: torch.Tensor | None,
    override_image: bool,
) -> Result[EditorLayout, AppError]:
    parsed = parse_state(state_json)
    if isinstance(parsed, Err):
        return parsed
    state = parsed.value
    w = width if width is not None else state.get("width")
    h = height if height is not None else state.get("height")
    image = reference_image if override_image else None
    if image is not None:
        if image.ndim != 4 or image.shape[0] < 1 or image.shape[3] not in (3, 4):
            return Err(editor_errors.runtime("Reference image must have shape [B, H, W, 3 or 4]"))
        h, w = image.shape[1:3]
    if isinstance(w, bool) or isinstance(h, bool) or not isinstance(w, int) or not isinstance(h, int):
        return Err(editor_errors.runtime("Canvas width and height must be integers"))
    if w < 1 or h < 1:
        return Err(editor_errors.runtime("Canvas width and height must be positive integers"))
    budget = image_budget(w, h, image.shape[0] if image is not None else 1)
    if isinstance(budget, Err):
        return Err(budget.error)
    regions = read_regions(state.get("elements"))
    if isinstance(regions, Err):
        return regions
    return Ok(EditorLayout(state, w, h, regions.value, image))


def editor_inputs(model_name: str) -> list[io.Input]:
    return [
        io.Int.Input(
            "width",
            default=1024,
            min=1,
            step=1,
            optional=True,
            tooltip="Generation canvas width. Also used to convert layout coordinates.",
        ),
        io.Int.Input(
            "height",
            default=1024,
            min=1,
            step=1,
            optional=True,
            tooltip="Generation canvas height. Also used to convert layout coordinates.",
        ),
        io.String.Input(
            "import_json",
            default="",
            optional=True,
            force_input=True,
            tooltip=(
                f"Optional {model_name} JSON seed. Connected JSON is applied on execution. "
                "Use clipboard Import JSON in the editor to edit a prompt visually."
            ),
        ),
        io.Image.Input("reference_image", optional=True, tooltip="Optional editor background/tracing image."),
        io.Custom("BBOX").Input(
            "bboxes", optional=True, advanced=True, tooltip="Optional list of [x, y, width, height] pixel boxes."
        ),
        io.String.Input(
            "state_json", default=json.dumps(DEFAULT_STATE), multiline=True, socketless=True, advanced=True
        ),
        io.Boolean.Input(
            "override_image",
            default=False,
            socketless=True,
            advanced=True,
            tooltip="Use the connected image and its dimensions instead of the editor reference image.",
        ),
        io.Boolean.Input(
            "override_bboxes",
            default=False,
            socketless=True,
            advanced=True,
            tooltip="Append connected BBOX regions to the editor regions on execution.",
        ),
    ]


def prepare_layout(
    *,
    state_json: str,
    width: int | None,
    height: int | None,
    reference_image: torch.Tensor | None,
    override_image: bool,
    bboxes: object,
    override_bboxes: bool,
    import_json: str,
    importer: Callable[[EditorLayout, str], Result[EditorLayout, AppError]],
) -> Result[EditorLayout, AppError]:
    resolved = resolve_layout(state_json, width, height, reference_image, override_image)
    if isinstance(resolved, Err):
        return resolved
    layout = resolved.value
    if import_json.strip():
        imported = importer(layout, import_json)
        if isinstance(imported, Err):
            return imported
        layout = imported.value
    if override_bboxes and bboxes is not None:
        boxes = import_pixel_bboxes(bboxes, layout.width, layout.height)
        if isinstance(boxes, Err):
            return boxes
        layout = replace(layout, regions=[*layout.regions, *boxes.value])
    if len(layout.regions) > MAX_REGIONS:
        return Err(editor_errors.runtime(f"Layouts support at most {MAX_REGIONS} regions"))
    return Ok(layout)


def editor_outputs() -> list[io.Output]:
    return [
        io.String.Output("json_prompt"),
        io.String.Output("json_pretty"),
        io.Image.Output("image"),
        io.Image.Output("preview"),
        io.Int.Output("width"),
        io.Int.Output("height"),
        io.Custom("BBOX").Output("bboxes"),
    ]


def reference_image_path(value: object) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts or relative.parts[:2] != REFERENCE_IMAGE_DIR.parts:
        return None
    root = Path(folder_paths.get_input_directory())
    path = root / relative
    if not path.resolve().is_relative_to((root / REFERENCE_IMAGE_DIR).resolve()):
        return None
    return path


def pil_to_tensor(image: Image.Image) -> torch.Tensor:
    data = torch.ByteTensor(bytearray(image.convert("RGB").tobytes()))
    return data.reshape(1, image.height, image.width, 3).to(dtype=torch.float32) / 255.0


def clean_image(layout: EditorLayout) -> Result[torch.Tensor, AppError]:
    if layout.reference_image is not None:
        return Ok(layout.reference_image)
    value = layout.state.get("reference_image_path")
    path = reference_image_path(value)
    if value and path is None:
        return Err(editor_errors.runtime("Invalid saved reference image path"))
    if path is not None:
        fit = layout.state.get("reference_image_fit")
        if fit not in ("stretch", "contain"):
            return Err(editor_errors.runtime("Reference image fit must be stretch or contain"))
        try:
            with Image.open(path) as image:
                budget = image_budget(image.width, image.height)
                if isinstance(budget, Err):
                    return Err(budget.error)
                size = (layout.width, layout.height)
                rgb = image.convert("RGB")
                fitted = (
                    ImageOps.pad(rgb, size, method=Image.Resampling.LANCZOS, color=(41, 44, 50))
                    if fit == "contain"
                    else rgb.resize(size, Image.Resampling.LANCZOS)
                )
                return Ok(pil_to_tensor(fitted))
        except (OSError, Image.DecompressionBombError) as error:
            return Err(editor_errors.runtime("Could not open saved reference image", cause=error))
    image = torch.full((1, layout.height, layout.width, 3), 0.105, dtype=torch.float32)
    image[:, ::64, :, :] = 0.18
    image[:, :, ::64, :] = 0.18
    return Ok(image)


def format_prompt(prompt: dict[str, object]) -> str:
    return _BBOX_PRETTY.sub(r'"bbox": [\1, \2, \3, \4]', json.dumps(prompt, indent=4, ensure_ascii=False))


def layout_output(layout: EditorLayout, prompt: dict[str, object]) -> io.NodeOutput:
    image = clean_image(layout)
    if isinstance(image, Err):
        return io.NodeOutput(block_execution=str(image.error))
    boxes: list[PixelBBox] = []
    for region in layout.regions:
        if region.bbox is None:
            continue
        y0, x0, y1, x1 = pixel_edges(region.bbox, layout.width, layout.height)
        boxes.append((x0, y0, x1 - x0, y1 - y0))
    previews: list[torch.Tensor] = []
    for frame in image.value:
        array = (frame.detach().to(device="cpu", dtype=torch.float32).clamp(0, 1).numpy() * 255).round().astype("uint8")
        preview = Image.fromarray(array).convert("RGB")
        draw = ImageDraw.Draw(preview, "RGBA")
        for index, region in enumerate(layout.regions, 1):
            if region.bbox is None:
                continue
            y0, x0, y1, x1 = pixel_edges(region.bbox, layout.width, layout.height)
            color = (120, 170, 255) if region.kind == "text" else (40, 220, 210)
            draw.rectangle((x0, y0, x1, y1), outline=(*color, 220), fill=(*color, 42), width=3)
            draw.text((x0 + 6, y0 + 4), f"{index:02d} {region.kind.upper()}", fill=(255, 255, 255, 255))
        previews.append(pil_to_tensor(preview))
    return io.NodeOutput(
        json.dumps(prompt, separators=(",", ":"), ensure_ascii=False),
        format_prompt(prompt),
        image.value,
        torch.cat(previews).to(device=image.value.device, dtype=image.value.dtype),
        layout.width,
        layout.height,
        boxes,
    )


prompt_server = getattr(PromptServer, "instance")  # noqa: B009 - dynamically exposed by Comfy.
routes = getattr(prompt_server, "routes")  # noqa: B009
register_ui_settings_routes(routes)
_reference_image_jobs = asyncio.Semaphore(2)


def store_reference_image(content: bytes, filename: str) -> Result[dict[str, object], AppError]:
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(filename).stem).strip("._")[:80] or "reference"
    relative = REFERENCE_IMAGE_DIR / f"{uuid.uuid4().hex}_{name}.png"
    path = Path(folder_paths.get_input_directory()) / relative
    try:
        with Image.open(byte_io.BytesIO(content)) as source:
            budget = image_budget(source.width, source.height)
            if isinstance(budget, Err):
                return Err(budget.error)
            with source.convert("RGB") as image:
                path.parent.mkdir(parents=True, exist_ok=True)
                with TemporaryDirectory(prefix=".reference-", dir=path.parent) as directory:
                    temporary = Path(directory) / path.name
                    image.save(temporary)
                    temporary.replace(path)
                return Ok({"path": relative.as_posix(), "name": filename, "width": image.width, "height": image.height})
    except (OSError, Image.DecompressionBombError, ValueError) as error:
        return Err(editor_errors.runtime("Could not decode or save reference image", cause=error))


@routes.post("/neriss_comfynodes/editor/reference_image")
async def upload_reference_image(request: web.Request) -> web.Response:
    if not request.content_type.startswith("multipart/"):
        return web.json_response({"error": "Expected multipart image file"}, status=400)
    limit = configured_limit("NERISS_MAX_REFERENCE_BYTES", 32 * 1024 * 1024)
    if isinstance(limit, Err):
        return store_response(limit)
    try:
        reader = await request.multipart()
        field = await reader.next()
        if not isinstance(field, BodyPartReader) or field.name != "image" or not field.filename:
            return web.json_response({"error": "Expected multipart image file"}, status=400)
        content = bytearray()
        while chunk := await field.read_chunk():
            content.extend(chunk)
            if len(content) > limit.value:
                return web.json_response({"error": "Reference image exceeds NERISS_MAX_REFERENCE_BYTES"}, status=413)
        if await reader.next() is not None:
            return web.json_response({"error": "Upload one image at a time"}, status=400)
    except (ValueError, AssertionError):
        return web.json_response({"error": "Invalid multipart image upload"}, status=400)
    async with _reference_image_jobs:
        result = await asyncio.to_thread(store_reference_image, bytes(content), field.filename)
    if isinstance(result, Err):
        return web.json_response({"error": str(result.error)}, status=400)
    return web.json_response(result.value)


@routes.get("/neriss_comfynodes/editor/reference_image")
async def get_reference_image(request: web.Request) -> web.StreamResponse:
    path = reference_image_path(request.query.get("path"))
    if path is None or not path.is_file():
        return web.json_response({"error": "Reference image not found"}, status=404)
    return web.FileResponse(path)


def color_library_path() -> Path:
    return Path(folder_paths.get_user_directory()) / "Neriss_ComfyNodes" / "editor_colors.json"


def normalize_color_library(value: object) -> dict[str, list[str]] | None:
    if not isinstance(value, dict):
        return None
    library: dict[str, list[str]] = {}
    for key in ("favorites", "recent"):
        colors = value.get(key)
        if not isinstance(colors, list) or len(colors) > MAX_COLORS:
            return None
        valid = [color for color in colors if isinstance(color, str) and re.fullmatch(r"#[0-9A-F]{6}", color)]
        if len(valid) != len(colors):
            return None
        library[key] = list(dict.fromkeys(valid))
    return library


def default_color_library() -> dict[str, list[str]]:
    return {"favorites": [], "recent": []}


@routes.get("/neriss_comfynodes/editor/colors")
async def get_color_library(_: web.Request) -> web.Response:
    return store_response(load_store(color_library_path(), default_color_library, normalize_color_library))


@routes.post("/neriss_comfynodes/editor/colors")
async def save_color_library(request: web.Request) -> web.Response:
    content = await request_json(request)
    if isinstance(content, Err):
        return store_response(content, 400)
    library = normalize_color_library(content.value)
    if library is None:
        return web.json_response({"error": "Expected favorites and recent lists of #RRGGBB colors"}, status=400)
    return store_response(
        save_store(
            color_library_path(),
            library,
            default_color_library,
            normalize_color_library,
            request.headers.get("If-Match"),
        )
    )
