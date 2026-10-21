"""MOSS-Image-Base experimental layout prompts in centered absolute pixels."""

from __future__ import annotations

from dataclasses import replace

import torch
from comfy_api.latest import io

from ..shared import AppError, Err, Ok, Result, editor_errors
from ..shared.layout_editor import (
    EditorLayout,
    LayoutRegion,
    centralized_bbox,
    clamp_bbox,
    editor_inputs,
    editor_outputs,
    layout_output,
    normalize_hex_palette,
    parse_json_object,
    prepare_layout,
    read_bbox,
    valid_palette,
)
from ..shared.limits import MAX_REGIONS, MAX_TAGS, MAX_TEXT_LENGTH


def build_moss_prompt(layout: EditorLayout) -> Result[dict[str, object], AppError]:
    caption = layout.state.get("high_level_description", "")
    meta = layout.state.get("moss_meta", [])
    if not isinstance(caption, str) or not isinstance(meta, list) or not all(isinstance(tag, str) for tag in meta):
        return Err(
            editor_errors.runtime("MOSS summary caption must be a string and metadata must be a list of strings")
        )
    items: list[dict[str, object]] = []
    for index, region in enumerate(layout.regions, 1):
        if region.bbox is None:
            title = (region.text if region.kind == "text" else region.caption).strip().split("\n")[0]
            title = title or f"Untitled {region.label or ('text' if region.kind == 'text' else 'object')} {index}"
            return Err(editor_errors.runtime(f'Draw a bounding box for "{title}" before exporting a MOSS prompt.'))
        item: dict[str, object] = {
            "label": region.label or ("text" if region.kind == "text" else "object"),
            "caption": region.caption,
            "bbox": list(centralized_bbox(region.bbox, layout.width, layout.height)),
        }
        if item["label"] == "text":
            item["text"] = region.text
        if region.palette:
            item["palette"] = list(region.palette)
        items.append(item)
    return Ok(
        {
            "summary": {"meta": meta, "canvas": "single", "caption": caption},
            "items": items,
            "bbox_coord_space": "abs_centralized",
            "bbox_format": "yxyx",
        }
    )


def import_moss_prompt(layout: EditorLayout, value: str) -> Result[EditorLayout, AppError]:
    parsed = parse_json_object(value, "MOSS layout prompt")
    if isinstance(parsed, Err):
        return parsed
    prompt = parsed.value
    if set(prompt) != {"summary", "items", "bbox_coord_space", "bbox_format"}:
        return Err(editor_errors.runtime("MOSS prompt requires summary, items, bbox_coord_space, and bbox_format"))
    if prompt.get("bbox_coord_space") != "abs_centralized" or prompt.get("bbox_format") != "yxyx":
        return Err(editor_errors.runtime("MOSS boxes must use abs_centralized coordinates in yxyx order"))
    summary = prompt.get("summary")
    items = prompt.get("items")
    if (
        not isinstance(summary, dict)
        or not set(summary) <= {"meta", "canvas", "caption"}
        or not isinstance(items, list)
        or len(items) > MAX_REGIONS
    ):
        return Err(editor_errors.runtime("MOSS prompt requires a summary with caption and an items list"))
    caption = summary.get("caption")
    meta = summary.get("meta", [])
    if summary.get("canvas", "single") != "single" or not isinstance(caption, str):
        return Err(editor_errors.runtime("MOSS summary requires a string caption and canvas='single' when provided"))
    if not isinstance(meta, list) or not all(isinstance(tag, str) for tag in meta):
        return Err(editor_errors.runtime("MOSS summary.meta must be a list of strings"))
    if (
        len(meta) > MAX_TAGS
        or len(caption) > MAX_TEXT_LENGTH
        or any(isinstance(tag, str) and len(tag) > MAX_TEXT_LENGTH for tag in meta)
    ):
        return Err(editor_errors.runtime("MOSS summary exceeds text or tag limits"))
    regions: list[LayoutRegion] = []
    for index, item in enumerate(items, 1):
        if not isinstance(item, dict):
            return Err(editor_errors.runtime(f"MOSS item {index} must be an object"))
        label = item.get("label")
        bbox = read_bbox(item.get("bbox"))
        desc = item.get("caption")
        text = item.get("text", "")
        palette = item.get("palette", [])
        if (
            not isinstance(label, str)
            or not label.strip()
            or bbox is None
            or not set(item) <= {"label", "caption", "bbox", "text", "palette"}
        ):
            return Err(editor_errors.runtime(f"MOSS item {index} has an invalid label, fields, or yxyx box"))
        label = label.strip()
        if label == "text" and "text" not in item:
            return Err(editor_errors.runtime(f"MOSS text item {index} requires literal text"))
        if not isinstance(desc, str) or not isinstance(text, str):
            return Err(editor_errors.runtime(f"MOSS item {index} caption and text must be strings"))
        if max(len(desc), len(text), len(label)) > MAX_TEXT_LENGTH:
            return Err(editor_errors.runtime(f"MOSS item {index} exceeds the text limit"))
        normalized_palette = normalize_hex_palette(palette, 5)
        if not valid_palette(palette, 5):
            return Err(editor_errors.runtime(f"MOSS item {index} palette must contain up to 5 hex colors"))
        y0, x0, y1, x1 = bbox
        normalized = (
            (y0 + layout.height / 2) / layout.height * 1000,
            (x0 + layout.width / 2) / layout.width * 1000,
            (y1 + layout.height / 2) / layout.height * 1000,
            (x1 + layout.width / 2) / layout.width * 1000,
        )
        regions.append(
            LayoutRegion(
                "text" if label == "text" else "obj", clamp_bbox(normalized), desc, text, normalized_palette, label
            )
        )
    return Ok(
        replace(layout, state={**layout.state, "high_level_description": caption, "moss_meta": meta}, regions=regions)
    )


class NerissMossLayoutPromptEditor(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Neriss_MossLayoutPromptEditor",
            display_name="🔨 MOSS Layout Prompt Editor",
            category="Neriss/MOSS",
            description=(
                "Build experimental MOSS-Image-Base layout JSON with object/text regions and centered absolute "
                "pixel boxes. Use the width and height outputs for the generation canvas."
            ),
            inputs=editor_inputs("MOSS"),
            outputs=editor_outputs(),
            search_aliases=["moss", "moss image", "layout prompt", "bbox", "structured prompt"],
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
            importer=import_moss_prompt,
        )
        if isinstance(layout, Err):
            return io.NodeOutput(block_execution=str(layout.error))
        prompt = build_moss_prompt(layout.value)
        if isinstance(prompt, Err):
            return io.NodeOutput(block_execution=str(prompt.error))
        return layout_output(layout.value, prompt.value)
