"""Ideogram-specific prompt conversion and style presets for the shared editor."""

from __future__ import annotations

import math
from dataclasses import replace
from pathlib import Path

import folder_paths
import torch
from aiohttp import web
from comfy_api.latest import io

from ..shared import AppError, Err, Ok, Result, editor_errors
from ..shared.json_store import load_store, request_json, save_store, store_response
from ..shared.layout_editor import (
    DEFAULT_STYLE,
    EditorLayout,
    LayoutRegion,
    clamp_bbox,
    editor_inputs,
    editor_outputs,
    layout_output,
    normalize_editor_style,
    normalize_hex_palette,
    parse_json_object,
    prepare_layout,
    read_bbox,
    routes,
    valid_palette,
)
from ..shared.limits import MAX_PRESETS, MAX_REGIONS, MAX_TEXT_LENGTH


def build_style_description(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    style: dict[str, object] = {}
    for key in ("aesthetics", "lighting", "medium"):
        text = value.get(key, "")
        if not isinstance(text, str):
            return None
        style[key] = text
    key = "photo" if value.get("mode") == "photo" else "art_style"
    selected_style = value.get(key, "")
    if not isinstance(selected_style, str):
        return None
    style[key] = selected_style
    palette = normalize_hex_palette(value.get("color_palette"), 16)
    if palette:
        style["color_palette"] = list(palette)
    return style


def prompt_element(region: LayoutRegion) -> dict[str, object]:
    element: dict[str, object] = {
        "type": region.kind,
        "desc": region.caption,
    }
    if region.bbox is not None:
        element["bbox"] = [math.floor(coord + 0.5) for coord in region.bbox]
    if region.kind == "text":
        element["text"] = region.text
    if region.palette:
        element["color_palette"] = list(region.palette)
    return element


def build_ideogram_prompt(layout: EditorLayout) -> dict[str, object]:
    state = layout.state
    prompt: dict[str, object] = {
        "high_level_description": state.get("high_level_description", ""),
        "compositional_deconstruction": {
            "background": state.get("background", ""),
            "elements": [prompt_element(region) for region in layout.regions],
        },
    }
    style = build_style_description(state.get("style_description"))
    if style is not None:
        prompt["style_description"] = style
    return prompt


def import_ideogram_prompt(layout: EditorLayout, value: str) -> Result[EditorLayout, AppError]:
    parsed = parse_json_object(value, "Ideogram prompt")
    if isinstance(parsed, Err):
        return parsed
    prompt = parsed.value
    if not prompt or set(prompt) - {"high_level_description", "style_description", "compositional_deconstruction"}:
        return Err(editor_errors.runtime("Invalid Ideogram prompt fields"))
    composition = prompt.get("compositional_deconstruction", {"background": "", "elements": []})
    if not isinstance(composition, dict):
        return Err(editor_errors.runtime("Ideogram prompt requires compositional_deconstruction.elements"))
    if set(composition) - {"background", "elements"}:
        return Err(editor_errors.runtime("Invalid Ideogram composition fields"))
    elements = composition.get("elements")
    if not isinstance(elements, list) or len(elements) > MAX_REGIONS:
        return Err(editor_errors.runtime("Ideogram prompt requires compositional_deconstruction.elements"))
    regions: list[LayoutRegion] = []
    caption = prompt.get("high_level_description", "")
    background = composition.get("background", "")
    if (
        not isinstance(caption, str)
        or not isinstance(background, str)
        or max(len(caption), len(background)) > MAX_TEXT_LENGTH
    ):
        return Err(editor_errors.runtime("Ideogram scene description and background must be bounded strings"))
    for index, item in enumerate(elements, 1):
        if not isinstance(item, dict):
            return Err(editor_errors.runtime(f"Ideogram element {index} must be an object"))
        kind = item.get("type")
        allowed_fields = {"type", "desc", "bbox", "color_palette"} | ({"text"} if kind == "text" else set())
        if set(item) - allowed_fields:
            return Err(editor_errors.runtime(f"Ideogram element {index} contains invalid fields"))
        bbox = read_bbox(item.get("bbox"))
        caption = item.get("desc")
        text = item.get("text", "")
        if (kind != "obj" and kind != "text") or ("bbox" in item and bbox is None):
            return Err(editor_errors.runtime(f"Ideogram element {index} has an invalid type or box"))
        if not isinstance(caption, str) or not isinstance(text, str):
            return Err(editor_errors.runtime(f"Ideogram element {index} description and text must be strings"))
        if max(len(caption), len(text)) > MAX_TEXT_LENGTH or not valid_palette(item.get("color_palette", []), 5):
            return Err(editor_errors.runtime(f"Ideogram element {index} has oversized text or an invalid palette"))
        regions.append(
            LayoutRegion(
                "text" if kind == "text" else "obj",
                clamp_bbox(bbox) if bbox is not None else None,
                caption,
                text,
                normalize_hex_palette(item.get("color_palette"), 5),
            )
        )
    state = {
        **layout.state,
        "high_level_description": prompt.get("high_level_description", ""),
        "background": composition.get("background", ""),
    }
    style = prompt.get("style_description")
    if "style_description" in prompt and not valid_prompt_style(style):
        return Err(editor_errors.runtime("Invalid Ideogram style description"))
    if isinstance(style, dict):
        state["style_description"] = {**DEFAULT_STYLE, **style, "mode": "photo" if "photo" in style else "art"}
    return Ok(replace(layout, state=state, regions=regions))


def style_presets_path() -> Path:
    return Path(folder_paths.get_input_directory()) / "Neriss_ComfyNodes" / "ideogram_v4_style_presets.json"


def valid_prompt_style(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    kind = "photo" if "photo" in value else "art_style"
    fields = {"aesthetics", "lighting", "medium", kind}
    if not fields <= set(value) <= fields | {"color_palette"}:
        return False
    for key in fields:
        text = value.get(key)
        if not isinstance(text, str) or len(text) > MAX_TEXT_LENGTH:
            return False
    return valid_palette(value.get("color_palette", []), 16)


def default_style_presets() -> dict[str, list[dict[str, object]]]:
    return {"presets": []}


def normalize_style_presets(value: object) -> dict[str, list[dict[str, object]]] | None:
    if not isinstance(value, dict):
        return None
    items = value.get("presets")
    if not isinstance(items, list) or len(items) > MAX_PRESETS:
        return None
    presets: list[dict[str, object]] = []
    ids: set[str] = set()
    names: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            return None
        preset_id, name = item.get("id"), item.get("name")
        style = normalize_editor_style(item.get("style"))
        if not isinstance(preset_id, str) or not preset_id or len(preset_id) > MAX_TEXT_LENGTH or preset_id in ids:
            return None
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > MAX_TEXT_LENGTH
            or name.strip() in names
            or style is None
        ):
            return None
        ids.add(preset_id)
        names.add(name.strip())
        presets.append({"id": preset_id, "name": name.strip(), "style": style})
    return {"presets": presets}


@routes.get("/neriss_comfynodes/ideogram/style_presets")
async def get_style_presets(_: web.Request) -> web.Response:
    return store_response(load_store(style_presets_path(), default_style_presets, normalize_style_presets))


@routes.post("/neriss_comfynodes/ideogram/style_presets")
async def save_style_presets(request: web.Request) -> web.Response:
    content = await request_json(request)
    if isinstance(content, Err):
        return store_response(content, 400)
    presets = normalize_style_presets(content.value)
    if presets is None:
        return web.json_response({"error": "Invalid style presets"}, status=400)
    return store_response(
        save_store(
            style_presets_path(),
            presets,
            default_style_presets,
            normalize_style_presets,
            request.headers.get("If-Match"),
        )
    )


class NerissIdeogramV4PromptEditor(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Neriss_IdeogramV4PromptEditor",
            display_name="🔨 Ideogram 4 Prompt Editor",
            category="Neriss/Ideogram",
            description="Build an Ideogram 4 structured JSON prompt with the shared visual layout editor.",
            inputs=editor_inputs("Ideogram 4"),
            outputs=editor_outputs(),
            search_aliases=["ideogram", "ideogram 4", "json prompt", "layout editor", "bbox prompt"],
        )

    @classmethod
    def execute(
        cls,
        state_json: str = "",
        width: int | None = None,
        height: int | None = None,
        import_json: str = "",
        reference_image: torch.Tensor | None = None,
        bboxes: object = None,
        override_image: bool = False,
        override_bboxes: bool = False,
        **_kwargs: object,
    ) -> io.NodeOutput:
        layout = prepare_layout(
            state_json=state_json,
            width=width,
            height=height,
            reference_image=reference_image,
            override_image=override_image,
            bboxes=bboxes,
            override_bboxes=override_bboxes,
            import_json=import_json,
            importer=import_ideogram_prompt,
        )
        if isinstance(layout, Err):
            return io.NodeOutput(block_execution=str(layout.error))
        return layout_output(layout.value, build_ideogram_prompt(layout.value))
