"""Discover LoRA targets without architecture tables and scale Comfy's patches."""

from __future__ import annotations

import asyncio
import json
import math
import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

import comfy.lora
import comfy.lora_convert
import comfy.sd
import comfy.utils
import folder_paths
import torch
from aiohttp import web
from comfy.model_patcher import ModelPatcher
from comfy_api.latest import io
from safetensors import SafetensorError, safe_open
from server import PromptServer

from ..shared import EditorError, Err, Ok, Result, editor_errors
from ..shared.json_store import parse_json
from ..shared.limits import finite_number

DEFAULT_STATE = '{"version":1,"lora_name":"","overrides":{}}'
MAX_TARGETS = 30_000
MAX_NAME = 2048
# Format suffixes, not model-family/block tables. Longest suffix wins.
ADAPTER_SUFFIXES = tuple(
    sorted(
        (
            ".lora_up.weight",
            ".lora_down.weight",
            ".lora_mid.weight",
            "_lora.up.weight",
            "_lora.down.weight",
            ".lora_B.weight",
            ".lora_A.weight",
            ".lora.up.weight",
            ".lora.down.weight",
            ".lora_B",
            ".lora_A",
            ".lora_linear_layer.up.weight",
            ".lora_linear_layer.down.weight",
            ".lora_B.default.weight",
            ".lora_A.default.weight",
            ".hada_w1_a",
            ".hada_w1_b",
            ".hada_w2_a",
            ".hada_w2_b",
            ".hada_t1",
            ".hada_t2",
            ".lokr_w1",
            ".lokr_w2",
            ".lokr_w1_a",
            ".lokr_w1_b",
            ".lokr_w2_a",
            ".lokr_w2_b",
            ".lokr_t2",
            ".a1.weight",
            ".a2.weight",
            ".b1.weight",
            ".b2.weight",
            ".oft_blocks",
            ".rescale",
            ".diff",
            ".diff_b",
            ".w_norm",
            ".b_norm",
        ),
        key=len,
        reverse=True,
    )
)
AUXILIARY_SUFFIXES = (".alpha", ".dora_scale", ".reshape_weight")
SPECIAL_SUFFIXES = (".set_weight", ".config")


class LoraManifest(TypedDict):
    lora_name: str
    targets: list[str]
    unsupported: list[str]


@dataclass(frozen=True)
class StrengthState:
    lora_name: str
    overrides: dict[str, float]


def target_name(key: str) -> str | None:
    return next((key[: -len(suffix)] for suffix in ADAPTER_SUFFIXES if key.endswith(suffix)), None)


def discover_targets(keys: Iterable[str], lora_name: str) -> Result[LoraManifest, EditorError]:
    targets: set[str] = set()
    unsupported: list[str] = []
    for key in keys:
        if len(key) > MAX_NAME:
            return Err(editor_errors.runtime("LoRA target name is too long"))
        target = target_name(key)
        if target:
            targets.add(target)
        elif not key.endswith(AUXILIARY_SUFFIXES):
            unsupported.append(key)
        if len(targets) + len(unsupported) > MAX_TARGETS:
            return Err(editor_errors.runtime("LoRA exceeds the 30,000 target limit"))
    return Ok({"lora_name": lora_name, "targets": sorted(targets), "unsupported": sorted(unsupported)})


def target_groups(target: str) -> list[str]:
    # Dots are real separators; preserve underscores except at numeric block boundaries.
    ends = {match.start() for match in re.finditer(r"\.", target)}
    ends.update(match.end() for match in re.finditer(r"_\d+(?=_|$)", target))
    return [target[:end] for end in sorted(ends) if 0 < end < len(target)]


def target_multiplier(target: str, overrides: dict[str, float]) -> float:
    for name in [target, *reversed(target_groups(target))]:
        if name in overrides:
            return overrides[name]
    return 1.0


def parse_strength_state(content: str) -> Result[StrengthState, EditorError]:
    parsed = parse_json(content)
    if isinstance(parsed, Err):
        return parsed
    value = parsed.value
    if not isinstance(value, dict):
        return Err(editor_errors.runtime("Invalid LoRA strength state"))
    version = value.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        return Err(editor_errors.runtime("Unsupported LoRA strength state; expected version 1"))
    name, overrides = value.get("lora_name"), value.get("overrides")
    if not isinstance(name, str) or len(name) > MAX_NAME or not isinstance(overrides, dict):
        return Err(editor_errors.runtime("Invalid LoRA strength state"))
    if len(overrides) > MAX_TARGETS:
        return Err(editor_errors.runtime("Too many LoRA strength overrides"))
    normalized: dict[str, float] = {}
    for key, strength in overrides.items():
        number = finite_number(strength)
        if not isinstance(key, str) or not key or len(key) > MAX_NAME or number is None or not -20 <= number <= 20:
            return Err(editor_errors.runtime("LoRA multipliers must be finite numbers between -20 and 20"))
        normalized[key] = number
    return Ok(StrengthState(name, normalized))


def lora_path(name: str) -> Result[Path, EditorError]:
    if not name.lower().endswith(".safetensors") or name not in folder_paths.get_filename_list("loras"):
        return Err(editor_errors.runtime("Select an installed .safetensors LoRA", {"status": 400}))
    path = folder_paths.get_full_path("loras", name)
    if path is None:
        return Err(editor_errors.runtime("LoRA file was not found", {"status": 404}))
    return Ok(Path(path))


def inspect_lora(name: str) -> Result[LoraManifest, EditorError]:
    path = lora_path(name)
    if isinstance(path, Err):
        return path
    try:
        with safe_open(str(path.value), framework="pt", device="cpu") as file:
            return discover_targets(file.keys(), name)
    except (OSError, SafetensorError) as error:
        return Err(editor_errors.runtime("Could not inspect the safetensors LoRA", {"status": 400}, error))


prompt_server = getattr(PromptServer, "instance")  # noqa: B009 - Comfy adds this attribute at startup.
routes = getattr(prompt_server, "routes")  # noqa: B009 - Keep dynamic for ty compatibility.


@routes.get("/neriss_comfynodes/lora/targets")
async def lora_targets(request: web.Request) -> web.Response:
    result = await asyncio.to_thread(inspect_lora, request.query.get("lora_name", ""))
    if isinstance(result, Err):
        return web.json_response({"error": str(result.error)}, status=400)
    return web.json_response(result.value)


def patch_strengths(
    original: dict[str, torch.Tensor],
    converted: dict[str, torch.Tensor],
    key_map: dict[str, object],
    state: StrengthState,
) -> Result[tuple[dict[object, float], list[str]], EditorError]:
    # Comfy's format converters rename/reuse tensors. Track identity so UI rules
    # remain attached to ORIGINAL names, even after a format conversion.
    origins: dict[int, set[str]] = defaultdict(set)
    for key, tensor in original.items():
        target = target_name(key)
        if target:
            origins[id(tensor)].add(target)
    sources: dict[str, set[str]] = defaultdict(set)
    for key, tensor in converted.items():
        if key.endswith(SPECIAL_SUFFIXES):
            return Err(
                editor_errors.runtime(
                    "This adapter contains weight replacements or configuration patches. "
                    "Use ComfyUI's standard loader; these operations are not supported by the strength editor yet."
                )
            )
        target = target_name(key)
        if target:
            sources[target].update(origins.get(id(tensor), set()))
    strengths: dict[object, float] = {}
    matched: set[str] = set()
    for target, source_names in sources.items():
        destination = key_map.get(target)
        if destination is None:
            continue
        if not source_names:
            return Err(editor_errors.runtime(f"Cannot safely track converted target: {target}"))
        values = {target_multiplier(source, state.overrides) for source in source_names}
        if len(values) != 1:
            return Err(editor_errors.runtime(f"Conflicting strengths for converted target: {target}"))
        strength = values.pop()
        destinations = [destination]
        if f"{target}.diff_b" in converted or f"{target}.b_norm" in converted:
            destinations.append(comfy.lora.bias_key(destination))
        for key in destinations:
            if key in strengths and strengths[key] != strength:
                return Err(editor_errors.runtime(f"Conflicting strengths for aliased target: {target}"))
            strengths[key] = strength
        matched.update(source_names)
    return Ok((strengths, sorted(set().union(*origins.values()) - matched) if origins else []))


class NerissLoraBlockStrengthEditor(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Neriss_LoraBlockStrengthEditor",
            display_name="🔨 LoRA Block Strength Editor",
            category="Neriss/LoRA",
            description="Edit strengths for the selected LoRA's actual targets without fixed model-family layouts.",
            inputs=[
                io.Model.Input("model"),
                io.Combo.Input(
                    "lora_name",
                    options=[
                        name
                        for name in folder_paths.get_filename_list("loras")
                        if name.lower().endswith(".safetensors")
                    ],
                ),
                io.Float.Input("strength_model", default=1.0, min=-20, max=20, step=0.01),
                io.Float.Input("strength_clip", default=1.0, min=-20, max=20, step=0.01),
                io.String.Input("state_json", default=DEFAULT_STATE, multiline=True),
                io.Clip.Input("clip", optional=True),
            ],
            outputs=[io.Model.Output(), io.Clip.Output(), io.String.Output(display_name="report")],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs: object) -> str:
        lora_name = kwargs.get("lora_name")
        if not isinstance(lora_name, str):
            return "missing"
        path = lora_path(lora_name)
        if isinstance(path, Err):
            return "missing"
        stat = path.value.stat()
        return f"{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_size}"

    @classmethod
    def execute(  # ty: ignore[invalid-method-override] - Comfy invokes schema-defined keyword inputs.
        cls,
        model: ModelPatcher,
        lora_name: str,
        strength_model: float,
        strength_clip: float,
        state_json: str,
        clip: comfy.sd.CLIP | None = None,
    ) -> io.NodeOutput:
        state = parse_strength_state(state_json)
        if isinstance(state, Err):
            raise ValueError(str(state.error))  # Comfy's execution boundary requires an exception.
        if state.value.overrides and state.value.lora_name != lora_name:
            raise ValueError("LoRA selection changed. Open the strength editor and reset overrides for this LoRA.")
        for strength in (strength_model, strength_clip):
            if not math.isfinite(strength) or not -20 <= strength <= 20:
                raise ValueError("Global LoRA strengths must be finite numbers between -20 and 20")
        path = lora_path(lora_name)
        if isinstance(path, Err):
            raise ValueError(str(path.error))
        original = comfy.utils.load_torch_file(str(path.value), safe_load=True)
        manifest = discover_targets(original.keys(), lora_name)
        if isinstance(manifest, Err):
            raise ValueError(str(manifest.error))
        valid_rules = set(manifest.value["targets"])
        for target in manifest.value["targets"]:
            valid_rules.update(target_groups(target))
        unused_rules = sorted(set(state.value.overrides) - valid_rules)
        # Some Comfy converters rename dictionary keys in place. Preserve raw
        # names for provenance without duplicating the tensor storage.
        converted = comfy.lora_convert.convert_lora(dict(original))
        key_map = comfy.lora.model_lora_keys_unet(model.model, {})
        if clip is not None:
            key_map = comfy.lora.model_lora_keys_clip(clip.cond_stage_model, key_map)
        plan = patch_strengths(original, converted, key_map, state.value)
        if isinstance(plan, Err):
            raise ValueError(str(plan.error))
        strengths, unmatched = plan.value
        loaded = comfy.lora.load_lora(converted, key_map)
        if not loaded:
            raise ValueError("No LoRA patches matched the connected MODEL/CLIP. Check LoRA compatibility.")
        if any(key not in strengths for key in loaded):
            raise ValueError("Adapter contains patches that cannot be safely assigned a strength yet.")
        new_model = model.clone()
        new_clip = clip.clone() if clip is not None else None
        groups: dict[float, dict[object, object]] = defaultdict(dict)
        for key, patch in loaded.items():
            groups[strengths[key]][key] = patch
        accepted: set[object] = set()
        for multiplier, patches in groups.items():
            if strength_model * multiplier != 0:
                accepted.update(new_model.add_patches(patches, strength_model * multiplier))
            if new_clip is not None and strength_clip * multiplier != 0:
                accepted.update(new_clip.add_patches(patches, strength_clip * multiplier))
        report = json.dumps(
            {
                "lora_name": lora_name,
                "resolved_patches": len(loaded),
                "applied_patches": len(accepted),
                "unmatched_targets": unmatched,
                "unused_overrides": unused_rules,
                "unrecognized_keys": manifest.value["unsupported"],
                "note": "Compatibility is resolved at execution. Zero strengths skip patches; "
                "overrides replace parent multipliers.",
            },
            indent=2,
        )
        return io.NodeOutput(new_model, new_clip, report)
