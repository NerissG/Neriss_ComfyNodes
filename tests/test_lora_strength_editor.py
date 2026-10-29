"""Exercise discovery and real ComfyUI patch math on tiny CPU-only models."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import torch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from comfy_test_support import lora
from safetensors.torch import save_file


def adapter(target: str, format_name: str = "regular") -> dict[str, torch.Tensor]:
    up = torch.tensor([[2.0], [3.0]])
    down = torch.tensor([[1.0, 4.0]])
    suffixes = {
        "regular": (".lora_up.weight", ".lora_down.weight"),
        "peft": (".lora_B.weight", ".lora_A.weight"),
        "default": (".lora_B.default.weight", ".lora_A.default.weight"),
    }
    a, b = suffixes[format_name]
    return {target + a: up, target + b: down}


class TinyModel(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.diffusion_model = torch.nn.ModuleDict(
            {
                "blocks": torch.nn.ModuleList(
                    [torch.nn.ModuleDict({"q": torch.nn.Linear(2, 2), "k": torch.nn.Linear(2, 2)}) for _ in range(2)]
                )
            }
        )
        self.model_config = SimpleNamespace(unet_config={})


def make_model() -> lora.ModelPatcher:
    return lora.ModelPatcher(TinyModel(), load_device=torch.device("cpu"), offload_device=torch.device("cpu"))


def make_clip() -> lora.comfy.sd.CLIP:
    clip = lora.comfy.sd.CLIP(no_init=True)
    clip.cond_stage_model = torch.nn.ModuleDict({"encoder": torch.nn.Linear(2, 2)})
    clip.patcher = lora.ModelPatcher(
        clip.cond_stage_model, load_device=torch.device("cpu"), offload_device=torch.device("cpu")
    )
    clip.tokenizer = None
    clip.tokenizer_options = {}
    clip.layer_idx = None
    clip.use_clip_schedule = False
    clip.apply_hooks_to_conds = None
    return clip


class DiscoveryTests(unittest.TestCase):
    def test_formats_and_auxiliary_keys_collapse_to_original_target_names(self) -> None:
        keys = [*adapter("blocks.0.q"), *adapter("lora_unet_input_blocks_10_q", "peft")]
        keys.extend(["blocks.0.q.alpha", "blocks.0.q.dora_scale", "special.set_weight", "unknown.weight"])
        result = lora.discover_targets(keys, "a.safetensors")
        self.assertIsInstance(result, lora.Ok)
        self.assertEqual(result.value["targets"], ["blocks.0.q", "lora_unet_input_blocks_10_q"])
        self.assertEqual(result.value["unsupported"], ["special.set_weight", "unknown.weight"])

    def test_specific_override_replaces_parent_without_index_prefix_collisions(self) -> None:
        rules = {"blocks": 0.5, "blocks.1": 0, "blocks.1.q": -1}
        for target, expected in (("blocks.1.q", -1), ("blocks.1.k", 0), ("blocks.10.q", 0.5), ("other.q", 1)):
            self.assertEqual(lora.target_multiplier(target, rules), expected)
        self.assertEqual(
            lora.target_groups("lora_unet_input_blocks_10_1_attn"),
            ["lora_unet_input_blocks_10", "lora_unet_input_blocks_10_1"],
        )

    def test_state_rejects_invalid_versions_booleans_nonfinite_and_huge_numbers(self) -> None:
        for content in [
            "{broken",
            "[]",
            '{"version":2}',
            '{"version":true}',
            *[
                json.dumps({"version": 1, "lora_name": "a", "overrides": {"q": value}})
                for value in (True, None, float("nan"), float("inf"), 21, -(10**1000))
            ],
        ]:
            with self.subTest(content=content[:80]):
                self.assertIsInstance(lora.parse_strength_state(content), lora.Err)
        self.assertIsInstance(lora.parse_strength_state(lora.DEFAULT_STATE), lora.Ok)

    def test_conversion_retains_original_strengths_and_tuple_slice_destinations(self) -> None:
        original = adapter("original.0.q")
        converted = {key.replace("original", "converted"): tensor for key, tensor in original.items()}
        destination = ("diffusion_model.qkv.weight", (0, 2))
        state = lora.StrengthState("a", {"original.0": -0.25})
        result = lora.patch_strengths(original, converted, {"converted.0.q": destination}, state)
        self.assertIsInstance(result, lora.Ok)
        self.assertEqual(result.value, ({destination: -0.25}, []))

    def test_real_comfy_format_conversion_keeps_rules_on_original_names(self) -> None:
        source = "lora_unet__blocks_0_cross_attn_k"
        original = adapter(source)
        converted = lora.comfy.lora_convert.convert_lora(dict(original))
        self.assertIn("lora_unet_blocks_0_cross_attn_k.lora_up.weight", converted)
        result = lora.patch_strengths(
            original,
            converted,
            {"lora_unet_blocks_0_cross_attn_k": "diffusion_model.q.weight"},
            lora.StrengthState("a", {source: 0.2}),
        )
        self.assertIsInstance(result, lora.Ok)
        self.assertEqual(result.value, ({"diffusion_model.q.weight": 0.2}, []))

    def test_special_patches_and_conflicting_aliases_fail_instead_of_silently_scaling(self) -> None:
        for suffix in lora.SPECIAL_SUFFIXES:
            value = {"q" + suffix: torch.ones(1)}
            self.assertIsInstance(lora.patch_strengths(value, value, {}, lora.StrengthState("a", {})), lora.Err)
        value = {**adapter("first"), **adapter("second")}
        result = lora.patch_strengths(
            value, value, {"first": "q.weight", "second": "q.weight"}, lora.StrengthState("a", {"second": 0})
        )
        self.assertIsInstance(result, lora.Err)


class ExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "test.safetensors"
        for name, value in (("get_filename_list", [self.path.name]), ("get_full_path", str(self.path))):
            patcher = patch.object(lora.folder_paths, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def execute(self, model: lora.ModelPatcher, overrides: dict[str, float], **kwargs: object) -> lora.io.NodeOutput:
        return lora.NerissLoraBlockStrengthEditor.execute(
            model=model,
            lora_name=self.path.name,
            strength_model=0.8,
            strength_clip=0.6,
            state_json=json.dumps({"version": 1, "lora_name": self.path.name, "overrides": overrides}),
            **kwargs,
        )

    def test_actual_patch_math_and_zero_negative_inherited_strengths_preserve_input(self) -> None:
        weights = {
            **adapter("diffusion_model.blocks.0.q"),
            **adapter("diffusion_model.blocks.0.k", "peft"),
            **adapter("diffusion_model.blocks.1.q", "default"),
        }
        save_file(weights, str(self.path))
        model = make_model()
        original = {key: value.clone() for key, value in model.model.state_dict().items()}
        result = self.execute(
            model, {"diffusion_model.blocks.0": 0.5, "diffusion_model.blocks.0.q": 0, "diffusion_model.blocks.1.q": -1}
        )
        patched, clip, report_json = result.result
        self.assertIsNot(patched, model)
        self.assertIsNone(clip)
        self.assertEqual(model.patches, {})
        self.assertNotIn("diffusion_model.blocks.0.q.weight", patched.patches)
        delta = torch.tensor([[2.0, 8.0], [3.0, 12.0]])
        for target, strength in (
            ("diffusion_model.blocks.0.k.weight", 0.4),
            ("diffusion_model.blocks.1.q.weight", -0.8),
        ):
            actual = patched.patch_weight_to_device(target, return_weight=True)
            torch.testing.assert_close(actual, original[target] + delta * strength)
        for key, value in model.model.state_dict().items():
            torch.testing.assert_close(value, original[key])
        report = json.loads(report_json)
        self.assertEqual(report["resolved_patches"], 3)
        self.assertEqual(report["applied_patches"], 2)

    def test_clip_uses_its_own_global_strength_and_is_optional(self) -> None:
        save_file({**adapter("diffusion_model.blocks.0.q"), **adapter("text_encoders.encoder")}, str(self.path))
        model, clip = make_model(), make_clip()
        patched, new_clip, report = self.execute(model, {}, clip=clip).result
        self.assertIsNot(new_clip, clip)
        self.assertEqual(clip.patcher.patches, {})
        self.assertAlmostEqual(patched.patches["diffusion_model.blocks.0.q.weight"][0][0], 0.8)
        self.assertAlmostEqual(new_clip.patcher.patches["encoder.weight"][0][0], 0.6)
        self.assertEqual(json.loads(report)["unmatched_targets"], [])
        _, no_clip, report = self.execute(model, {}).result
        self.assertIsNone(no_clip)
        self.assertEqual(json.loads(report)["unmatched_targets"], ["text_encoders.encoder"])

    def test_execution_preserves_raw_names_through_an_in_place_comfy_converter(self) -> None:
        source = "lora_unet__blocks_0_cross_attn_k"
        save_file(adapter(source), str(self.path))
        with patch.object(
            lora.comfy.lora,
            "model_lora_keys_unet",
            return_value={"lora_unet_blocks_0_cross_attn_k": "diffusion_model.blocks.0.k.weight"},
        ):
            patched, _, report = self.execute(make_model(), {source: 0.2}).result
        self.assertAlmostEqual(patched.patches["diffusion_model.blocks.0.k.weight"][0][0], 0.16)
        self.assertEqual(json.loads(report)["unused_overrides"], [])
        self.assertEqual(json.loads(report)["unmatched_targets"], [])

    def test_uniform_dora_strength_matches_comfys_standard_loader(self) -> None:
        weights = adapter("diffusion_model.blocks.0.q")
        weights["diffusion_model.blocks.0.q.dora_scale"] = torch.tensor([[1.0], [1.5]])
        save_file(weights, str(self.path))
        model = make_model()
        edited, _, _ = self.execute(model, {}).result
        reference, _ = lora.comfy.sd.load_lora_for_models(model, None, weights, 0.8, 0)
        key = "diffusion_model.blocks.0.q.weight"
        torch.testing.assert_close(
            edited.patch_weight_to_device(key, return_weight=True),
            reference.patch_weight_to_device(key, return_weight=True),
        )

    def test_no_matches_selection_change_and_special_adapters_fail_clearly(self) -> None:
        model = make_model()
        for weights, message in (
            (adapter("not_a_target"), "No LoRA patches matched"),
            ({"q.set_weight": torch.ones(2, 2)}, "weight replacements"),
        ):
            save_file(weights, str(self.path))
            with self.assertRaisesRegex(ValueError, message):
                self.execute(model, {})
        with self.assertRaisesRegex(ValueError, "selection changed"):
            lora.NerissLoraBlockStrengthEditor.execute(
                model,
                self.path.name,
                1,
                1,
                json.dumps({"version": 1, "lora_name": "other", "overrides": {"q": 0.5}}),
            )

    def test_diff_bias_and_weight_receive_the_same_multiplier(self) -> None:
        save_file(
            {"diffusion_model.blocks.0.q.diff": torch.ones(2, 2), "diffusion_model.blocks.0.q.diff_b": torch.ones(2)},
            str(self.path),
        )
        model = make_model()
        patched, _, _ = self.execute(model, {"diffusion_model.blocks.0.q": 0.5}).result
        self.assertEqual(patched.patches["diffusion_model.blocks.0.q.weight"][0][0], 0.4)
        self.assertEqual(patched.patches["diffusion_model.blocks.0.q.bias"][0][0], 0.4)

    def test_header_discovery_does_not_load_tensors_and_fingerprint_changes(self) -> None:
        save_file(adapter("diffusion_model.blocks.0.q"), str(self.path))
        with patch.object(lora.comfy.utils, "load_torch_file", side_effect=AssertionError("Must not load weights")):
            manifest = lora.inspect_lora(self.path.name)
        self.assertIsInstance(manifest, lora.Ok)
        self.assertEqual(manifest.value["targets"], ["diffusion_model.blocks.0.q"])
        first = lora.NerissLoraBlockStrengthEditor.fingerprint_inputs(lora_name=self.path.name)
        save_file({**adapter("diffusion_model.blocks.0.q"), **adapter("diffusion_model.blocks.0.k")}, str(self.path))
        self.assertNotEqual(first, lora.NerissLoraBlockStrengthEditor.fingerprint_inputs(lora_name=self.path.name))


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_installed_header_only_endpoint_and_invalid_paths(self) -> None:
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "demo.safetensors"
            save_file(adapter("blocks.0.q"), str(path))
            app = web.Application()
            app.add_routes(lora.routes)
            async with TestClient(TestServer(app)) as client:
                with (
                    patch.object(lora.folder_paths, "get_filename_list", return_value=[path.name]),
                    patch.object(lora.folder_paths, "get_full_path", return_value=str(path)),
                ):
                    response = await client.get("/neriss_comfynodes/lora/targets", params={"lora_name": path.name})
                    self.assertEqual(response.status, 200)
                    self.assertEqual((await response.json())["targets"], ["blocks.0.q"])
                    for name in ("../../secret.safetensors", "missing.safetensors", "unsafe.pt", ""):
                        response = await client.get("/neriss_comfynodes/lora/targets", params={"lora_name": name})
                        self.assertEqual(response.status, 400)
                    path.write_bytes(b"not safetensors")
                    response = await client.get("/neriss_comfynodes/lora/targets", params={"lora_name": path.name})
                    self.assertEqual(response.status, 400)
