"""Integration checks using the neighboring ComfyUI installation, without starting a server."""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import torch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from comfy_test_support import ROOT, execution, ideogram, moss, package, resolution, ui_settings
from PIL import Image

SAMPLE = (ROOT / "tests/fixtures/moss_layout.json").read_text(encoding="utf-8")
CHARACTER_SAMPLE = (ROOT / "tests/fixtures/moss_character_layout.json").read_text(encoding="utf-8")
PALETTE_SAMPLE = (ROOT / "tests/fixtures/moss_palette_layout.json").read_text(encoding="utf-8")


class UiSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        patcher = patch.object(ui_settings.folder_paths, "get_user_directory", return_value=directory.name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_defaults_and_validation_match_frontend_fixtures(self) -> None:
        cases = json.loads((ROOT / "tests/fixtures/ui_settings.json").read_text())
        self.assertEqual(ui_settings.DEFAULT_BINDINGS, cases["defaultBindings"])
        for value in cases["valid"]:
            with self.subTest(valid=value):
                self.assertIsInstance(ui_settings.normalize_ui_settings(value), ui_settings.Ok)
        for value in cases["invalid"]:
            with self.subTest(invalid=value):
                self.assertIsInstance(ui_settings.normalize_ui_settings(value), ui_settings.Err)
        for key in "abcdefghijklmnopqrstuvwxyz0123456789`~!@#$%^&*()_+-=[]{}\\|;:'\",.<>/?":
            self.assertIsInstance(ui_settings.normalize_binding({"key": key, "modifiers": []}), ui_settings.Ok, key)
        for key in ("é", "ä", "∫", "ß", "😀"):
            self.assertIsInstance(ui_settings.normalize_binding({"key": key, "modifiers": []}), ui_settings.Ok, key)

    def test_missing_file_returns_defaults_without_creating_it(self) -> None:
        result = ui_settings.load_ui_settings()
        self.assertIsInstance(result, ui_settings.Ok)
        self.assertEqual(result.value, ui_settings.default_ui_settings())
        self.assertFalse(ui_settings.ui_settings_path().exists())

    def test_atomic_save_round_trip_and_scope(self) -> None:
        settings = ui_settings.default_ui_settings()
        settings["editor"]["sidebarWidth"] = 510
        settings["editor"]["shortcuts"] = {"tool.select": [{"key": "b", "modifiers": []}]}
        saved = ui_settings.write_ui_settings(settings)
        self.assertIsInstance(saved, ui_settings.Ok)
        path = self.directory / "Neriss_ComfyNodes" / "ui_settings.json"
        self.assertEqual(json.loads(path.read_text()), settings)
        self.assertEqual(ui_settings.load_ui_settings().value, settings)
        self.assertEqual(list(path.parent.iterdir()), [path])

    def test_corrupt_unsupported_and_invalid_utf8_files_are_never_replaced(self) -> None:
        path = ui_settings.ui_settings_path()
        path.parent.mkdir(parents=True)
        for content in (b"{broken", b'{"version":2}', b"\xff\xfe", b'{"version":1,"editor":{"sidebarWidth":1}}'):
            with self.subTest(content=content):
                path.write_bytes(content)
                self.assertIsInstance(ui_settings.load_ui_settings(), ui_settings.Err)
                self.assertIsInstance(ui_settings.write_ui_settings(ui_settings.default_ui_settings()), ui_settings.Err)
                self.assertEqual(path.read_bytes(), content)

    def test_failed_replace_preserves_previous_file_and_cleans_temporary_files(self) -> None:
        first = ui_settings.default_ui_settings()
        self.assertIsInstance(ui_settings.write_ui_settings(first), ui_settings.Ok)
        path = ui_settings.ui_settings_path()
        original = path.read_bytes()
        next_settings = ui_settings.default_ui_settings()
        next_settings["editor"]["sidebarWidth"] = 600
        with patch.object(Path, "replace", side_effect=PermissionError("Read-only settings")):
            self.assertIsInstance(ui_settings.write_ui_settings(next_settings), ui_settings.Err)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(path.parent.iterdir()), [path])


class UiSettingsRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_post_validation_and_corruption_protection(self) -> None:
        with (
            TemporaryDirectory() as directory,
            patch.object(ui_settings.folder_paths, "get_user_directory", return_value=directory),
        ):
            routes = web.RouteTableDef()
            ui_settings.register_ui_settings_routes(routes)
            app = web.Application()
            app.add_routes(routes)
            async with TestClient(TestServer(app)) as client:
                endpoint = "/neriss_comfynodes/ui/settings"
                response = await client.get(endpoint)
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.json(), ui_settings.default_ui_settings())
                settings = {"version": 1, "editor": {"sidebarWidth": 540, "shortcuts": {"tool.pan": []}}}
                response = await client.post(endpoint, json=settings)
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.json(), settings)
                response = await client.get(endpoint)
                self.assertEqual(await response.json(), settings)
                for payload in ({"version": 2}, {"version": 1, "editor": {"shortcuts": {"unknown": []}}}):
                    response = await client.post(endpoint, json=payload)
                    self.assertEqual(response.status, 400)
                response = await client.post(endpoint, data="{broken", headers={"Content-Type": "application/json"})
                self.assertEqual(response.status, 400)
                path = ui_settings.ui_settings_path()
                path.write_text("{broken")
                response = await client.get(endpoint)
                self.assertEqual(response.status, 500)
                response = await client.post(endpoint, json=settings)
                self.assertEqual(response.status, 500)
                self.assertEqual(path.read_text(), "{broken")


class ResolutionSelectorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patcher = patch.object(resolution.folder_paths, "get_user_directory", return_value=directory.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.inputs: dict[str, object] = {
            "preset": "Custom portrait",
            "preset_aspect_x": 9,
            "preset_aspect_y": 16,
            "flip": False,
            "mode": "megapixels",
            "megapixels": 1.0,
            "squared": 1024,
            "multiple": 16,
            "custom": False,
            "aspect_x": 1,
            "aspect_y": 1,
        }

    async def validate(self, **overrides: object) -> tuple[bool, list[dict[str, object]], str]:
        prompt = {"1": {"class_type": "Neriss_ResolutionSelector", "inputs": {**self.inputs, **overrides}}}
        with patch.dict(
            execution.nodes.NODE_CLASS_MAPPINGS, {"Neriss_ResolutionSelector": resolution.NerissResolutionSelector}
        ):
            return await execution.validate_inputs("resolution-regression", prompt, "1", {})

    async def test_saved_ratio_validates_and_executes_without_the_original_preset_library(self) -> None:
        path = resolution.get_resolution_presets_path()
        libraries = (
            None,
            {"presets": [{"name": "Renamed portrait", "x": 9, "y": 16}]},
            {"presets": [{"name": "Custom portrait", "x": 1, "y": 1}]},
            "{broken",
        )
        for library in libraries:
            with self.subTest(library=library):
                if library is not None:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(library if isinstance(library, str) else json.dumps(library), encoding="utf-8")
                valid, errors, _ = await self.validate()
                self.assertTrue(valid, errors)
                output = resolution.NerissResolutionSelector.execute(**self.inputs)
                self.assertIsNone(output.block_execution)
                self.assertEqual(output.result, (752, 1328))
        flipped = resolution.NerissResolutionSelector.execute(**{**self.inputs, "flip": True})
        self.assertEqual(flipped.result, (1328, 752))

    async def test_comfy_input_constraints_are_not_bypassed(self) -> None:
        for field, value in (
            ("preset_aspect_x", 0),
            ("preset_aspect_y", 100001),
            ("multiple", 0),
            ("megapixels", 65),
            ("mode", "invalid"),
            ("preset", 123),
        ):
            with self.subTest(field=field):
                valid, errors, _ = await self.validate(**{field: value})
                self.assertFalse(valid)
                self.assertTrue(any(error["extra_info"]["input_name"] == field for error in errors))
        prompt_inputs = dict(self.inputs)
        del prompt_inputs["preset_aspect_x"]
        prompt = {"1": {"class_type": "Neriss_ResolutionSelector", "inputs": prompt_inputs}}
        with patch.dict(
            execution.nodes.NODE_CLASS_MAPPINGS, {"Neriss_ResolutionSelector": resolution.NerissResolutionSelector}
        ):
            valid, errors, _ = await execution.validate_inputs("resolution-regression", prompt, "1", {})
        self.assertFalse(valid)
        self.assertEqual(errors[0]["type"], "required_input_missing")

    def test_schema_and_execution_do_not_read_or_create_a_local_library(self) -> None:
        with patch.object(
            resolution.folder_paths, "get_user_directory", side_effect=AssertionError("Unexpected disk I/O")
        ):
            schema = resolution.NerissResolutionSelector.define_schema()
            self.assertEqual(schema.node_id, "Neriss_ResolutionSelector")
            info = resolution.NerissResolutionSelector.GET_NODE_INFO_V1()
            self.assertEqual(info["input"]["required"]["preset"][0], "COMBO")
            self.assertIsNone(resolution.NerissResolutionSelector.execute(**self.inputs).block_execution)

    def test_missing_snapshot_is_not_recovered_from_a_local_preset(self) -> None:
        inputs = {key: value for key, value in self.inputs.items() if key != "preset_aspect_x"}
        with patch.object(resolution, "load_store", side_effect=AssertionError("Unexpected library lookup")):
            output = resolution.NerissResolutionSelector.execute(**inputs)
        self.assertIn("no saved aspect-ratio snapshot", output.block_execution)


class LayoutPromptTests(unittest.TestCase):
    def test_web_development_assets_require_explicit_opt_in(self) -> None:
        self.addCleanup(importlib.reload, package)
        for value in (None, "", "0", "true", "1"):
            with self.subTest(value=value), patch.dict(os.environ):
                if value is None:
                    os.environ.pop("WEB_DEV", None)
                else:
                    os.environ["WEB_DEV"] = value
                self.assertEqual(
                    importlib.reload(package).WEB_DIRECTORY,
                    "./web/dev" if value == "1" else "./web/dist",
                )

    def test_resolution_sizing_matches_shared_frontend_cases(self) -> None:
        cases = json.loads((ROOT / "tests/fixtures/resolution_sizing.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(
                    resolution.calculate_resolution(
                        case["aspect_x"], case["aspect_y"], case["target_pixels"], case["multiple"]
                    ),
                    (case["width"], case["height"]),
                )

    def test_unplaced_children_do_not_invent_bounding_boxes(self) -> None:
        parent = {"id": "parent", "type": "obj", "desc": "Parent", "bbox": [100, 100, 900, 900]}
        child = {
            "id": "child",
            "parent_id": "parent",
            "type": "text",
            "desc": "Small label",
            "text": "Hello",
            "bbox": None,
            "color_palette": ["#123ABC"],
        }
        state = json.dumps({"elements": [parent, child]})
        output = ideogram.NerissIdeogramV4PromptEditor.execute(state_json=state, width=80, height=120)
        self.assertIsNone(output.block_execution)
        prompt = json.loads(output.result[0])
        self.assertEqual(
            prompt["compositional_deconstruction"]["elements"][1],
            {
                "type": "text",
                "desc": "Small label",
                "text": "Hello",
                "color_palette": ["#123ABC"],
            },
        )
        self.assertEqual(output.result[6], [(8, 12, 64, 96)])
        imported = ideogram.NerissIdeogramV4PromptEditor.execute(import_json=output.result[0], width=80, height=120)
        self.assertEqual(json.loads(imported.result[0]), prompt)
        self.assertEqual(imported.result[6], output.result[6])
        blocked = moss.NerissMossLayoutPromptEditor.execute(state_json=state, width=80, height=120)
        self.assertIn('Draw a bounding box for "Hello"', blocked.block_execution)
        child["bbox"] = [300, 400, 500, 600]
        placed = moss.NerissMossLayoutPromptEditor.execute(
            state_json=json.dumps({"elements": [parent, child]}), width=80, height=120
        )
        self.assertIsNone(placed.block_execution)
        self.assertEqual(len(json.loads(placed.result[0])["items"]), 2)
        self.assertEqual(placed.result[6][1], (32, 36, 16, 24))

    def test_nested_editor_state_compiles_to_native_parent_first_prompts(self) -> None:
        def region(region_id: str, parent_id: str | None, bbox: list[int]) -> dict[str, object]:
            return {
                "id": region_id,
                "parent_id": parent_id,
                "type": "text" if region_id == "detail" else "obj",
                "desc": region_id,
                "text": "Hello",
                "bbox": bbox,
                "color_palette": ["#123ABC"],
            }

        elements = [
            region("detail", "child", [300, 400, 500, 600]),
            region("parent", None, [100, 100, 200, 200]),
            region("other", None, [0, 0, 1000, 1000]),
            region("child", "parent", [250, 350, 550, 650]),
        ]
        flat = [elements[index] for index in (1, 3, 0, 2)]
        flat = [{key: value for key, value in item.items() if key != "parent_id"} for item in flat]
        for node in (moss.NerissMossLayoutPromptEditor, ideogram.NerissIdeogramV4PromptEditor):
            with self.subTest(node=node):
                nested = node.execute(state_json=json.dumps({"elements": elements}), width=80, height=120)
                expected = node.execute(state_json=json.dumps({"elements": flat}), width=80, height=120)
                self.assertIsNone(nested.block_execution)
                self.assertEqual(json.loads(nested.result[0]), json.loads(expected.result[0]))
                self.assertNotIn("parent_id", nested.result[0])
                self.assertEqual(nested.result[6], expected.result[6])

        for parent_id in ("detail", "parent", "missing"):
            elements[1]["parent_id"] = parent_id
            for node in (moss.NerissMossLayoutPromptEditor, ideogram.NerissIdeogramV4PromptEditor):
                output = node.execute(state_json=json.dumps({"elements": elements}), width=80, height=120)
                self.assertIsNotNone(output.block_execution)
        elements[1]["parent_id"] = None
        elements.append(dict(elements[0]))
        self.assertIsNotNone(
            moss.NerissMossLayoutPromptEditor.execute(state_json=json.dumps({"elements": elements})).block_execution
        )

    def test_reference_fitting_matches_preview_for_both_models(self) -> None:
        layout_module = importlib.import_module(f"{ROOT.name}.shared.layout_editor")
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "reference.png"
            source = Image.new("RGB", (80, 40), (255, 0, 0))
            source.save(path)
            for node in (moss.NerissMossLayoutPromptEditor, ideogram.NerissIdeogramV4PromptEditor):
                for fit in ("stretch", "contain"):
                    with self.subTest(node=node.__name__, fit=fit):
                        state = {
                            "width": 80,
                            "height": 80,
                            "reference_image_path": "reference.png",
                            "reference_image_fit": fit,
                        }
                        with patch.object(layout_module, "reference_image_path", return_value=path):
                            output = node.execute(state_json=json.dumps(state))
                        self.assertIsNone(output.block_execution)
                        image = output.result[2]
                        preview = output.result[3]
                        self.assertEqual(tuple(image.shape), (1, 80, 80, 3))
                        self.assertTrue(torch.equal(image, preview))
                        self.assertTrue(torch.equal(image[0, 40, 40], torch.tensor([1.0, 0.0, 0.0])))
                        edge = torch.tensor([41, 44, 50]) / 255 if fit == "contain" else torch.tensor([1.0, 0.0, 0.0])
                        self.assertTrue(torch.equal(image[0, 0, 40], edge))

    def test_moss_palette_import_and_state_output(self) -> None:
        prompt = json.loads(PALETTE_SAMPLE)
        output = moss.NerissMossLayoutPromptEditor.execute(import_json=PALETTE_SAMPLE)
        self.assertIsNone(output.block_execution)
        self.assertEqual(
            json.loads(output.result[0]),
            {**prompt, "summary": {**prompt["summary"], "meta": [], "canvas": "single"}},
        )
        region = {
            "type": "obj",
            "label": "object",
            "desc": "Retained caption",
            "text": "探索 🌄",
            "bbox": [250, 250, 750, 750],
            "color_palette": ["#123ABC", "#FFFFFF"],
        }
        for label in ("object", "character", "text"):
            with self.subTest(label=label):
                region.update(type="text" if label == "text" else "obj", label=label)
                output = moss.NerissMossLayoutPromptEditor.execute(state_json=json.dumps({"elements": [region]}))
                self.assertIsNone(output.block_execution)
                item = json.loads(output.result[0])["items"][0]
                self.assertEqual(item["palette"], region["color_palette"])
                self.assertEqual(item["caption"], region["desc"])
                if label == "text":
                    self.assertEqual(item["text"], region["text"])
                else:
                    self.assertNotIn("text", item)
                imported = moss.NerissMossLayoutPromptEditor.execute(import_json=output.result[0])
                self.assertEqual(json.loads(imported.result[0]), json.loads(output.result[0]))

    def test_invalid_moss_palettes_are_blocked(self) -> None:
        prompt = json.loads(PALETTE_SAMPLE)
        for palette in ("#FFFFFF", ["red"], ["#12345G"], ["#FFFFFF"] * 6):
            with self.subTest(palette=palette):
                prompt["items"][0]["palette"] = palette
                output = moss.NerissMossLayoutPromptEditor.execute(import_json=json.dumps(prompt))
                self.assertIn("palette", output.block_execution)

    def test_custom_labels_and_optional_summary_with_matching_canvas(self) -> None:
        prompt = json.loads(CHARACTER_SAMPLE)
        expected = {**prompt, "summary": {**prompt["summary"], "meta": [], "canvas": "single"}}
        for width, height in ((1088, 1344), (2048, 1536)):
            with self.subTest(width=width, height=height):
                output = moss.NerissMossLayoutPromptEditor.execute(
                    import_json=CHARACTER_SAMPLE, width=width, height=height
                )
                self.assertIsNone(output.block_execution)
                self.assertEqual(json.loads(output.result[0]), expected)

    def test_both_models_contain_saved_elements_and_external_bboxes(self) -> None:
        state = {"elements": [{"type": "obj", "label": "character", "desc": "Cat", "bbox": [-100, -200, 1100, 1200]}]}
        for node in (moss.NerissMossLayoutPromptEditor, ideogram.NerissIdeogramV4PromptEditor):
            with self.subTest(node=node):
                output = node.execute(
                    state_json=json.dumps(state),
                    width=1000,
                    height=1000,
                    bboxes=[(-200, -100, 1400, 1200)],
                    override_bboxes=True,
                )
                self.assertIsNone(output.block_execution)
                self.assertEqual(output.result[6], [(0, 0, 1000, 1000), (0, 0, 1000, 1000)])
                if node is moss.NerissMossLayoutPromptEditor:
                    prompt = json.loads(output.result[0])
                    self.assertEqual(prompt["items"][0]["label"], "character")
                    self.assertEqual(prompt["items"][0]["bbox"], [-500, -500, 500, 500])

    def test_imported_moss_boxes_are_clipped_to_the_image(self) -> None:
        output = moss.NerissMossLayoutPromptEditor.execute(import_json=CHARACTER_SAMPLE)
        self.assertIsNone(output.block_execution)
        items = json.loads(output.result[0])["items"]
        self.assertEqual(
            [item["bbox"] for item in items],
            [
                [-512, -400, 167, 182],
                [-367, -397, 512, 288],
                [-512, -512, 185, 93],
            ],
        )

    def test_imported_ideogram_boxes_are_clipped_to_the_image(self) -> None:
        prompt = {
            "compositional_deconstruction": {
                "background": "White",
                "elements": [
                    {"type": "obj", "bbox": [-100, -200, 1100, 1200], "desc": "Cat"},
                ],
            }
        }
        output = ideogram.NerissIdeogramV4PromptEditor.execute(import_json=json.dumps(prompt))
        self.assertIsNone(output.block_execution)
        self.assertEqual(
            json.loads(output.result[0])["compositional_deconstruction"]["elements"][0]["bbox"], [0, 0, 1000, 1000]
        )

    def test_canvas_sides_are_not_limited_to_8192_or_a_minimum_of_64(self) -> None:
        for node in (moss.NerissMossLayoutPromptEditor, ideogram.NerissIdeogramV4PromptEditor):
            for width, height in ((16000, 3), (3, 16000), (1, 3)):
                with self.subTest(node=node, width=width, height=height):
                    output = node.execute(width=width, height=height)
                    self.assertIsNone(output.block_execution)
                    self.assertEqual(output.result[4:6], (width, height))
                    self.assertEqual(tuple(output.result[2].shape), (1, height, width, 3))
            self.assertIsNotNone(node.execute(width=0, height=1).block_execution)

    def test_sample_prompt_roundtrip_and_pixel_outputs(self) -> None:
        output = moss.NerissMossLayoutPromptEditor.execute(import_json=SAMPLE)
        self.assertIsNone(output.block_execution)
        prompt, pretty, image, preview, width, height, boxes = output.result
        self.assertEqual(json.loads(prompt), json.loads(SAMPLE))
        self.assertEqual(json.loads(pretty), json.loads(prompt))
        self.assertIn('"bbox": [-416.0, -384.0, -288.0, 384.0]', pretty)
        self.assertEqual((width, height), (1024, 1024))
        self.assertEqual(boxes, [(128, 96, 768, 128), (224, 320, 576, 576)])
        self.assertEqual(tuple(image.shape), (1, height, width, 3))
        self.assertEqual(tuple(preview.shape), tuple(image.shape))
        self.assertFalse(torch.equal(image, preview))

    def test_rectangular_and_odd_canvases(self) -> None:
        for width, height in [(1536, 768), (768, 1536), (1025, 769)]:
            with self.subTest(width=width, height=height):
                state = {"elements": [{"type": "obj", "desc": "Full canvas", "bbox": [0, 0, 1000, 1000]}]}
                output = moss.NerissMossLayoutPromptEditor.execute(
                    state_json=json.dumps(state), width=width, height=height
                )
                prompt = json.loads(output.result[0])
                self.assertEqual(prompt["items"][0]["bbox"], [-height / 2, -width / 2, height / 2, width / 2])
                self.assertEqual(output.result[6], [(0, 0, width, height)])
                roundtrip = moss.NerissMossLayoutPromptEditor.execute(
                    import_json=output.result[0], width=width, height=height
                )
                self.assertEqual(json.loads(roundtrip.result[0]), prompt)

    def test_pixel_boxes_do_not_lose_precision_at_high_resolution(self) -> None:
        output = moss.NerissMossLayoutPromptEditor.execute(
            width=8192, height=4096, bboxes=[(1, 3, 17, 23)], override_bboxes=True
        )
        self.assertEqual(output.result[6], [(1, 3, 17, 23)])
        self.assertEqual(json.loads(output.result[0])["items"][0]["bbox"], [-2045, -4095, -2022, -4078])

    def test_import_then_append_boxes_and_reference_image_dimensions(self) -> None:
        image = torch.zeros((1, 1024, 1536, 3))
        output = moss.NerissMossLayoutPromptEditor.execute(
            width=512,
            height=512,
            import_json=SAMPLE,
            reference_image=image,
            override_image=True,
            bboxes=[(0, 0, 128, 64)],
            override_bboxes=True,
        )
        self.assertEqual(output.result[4:6], (1536, 1024))
        self.assertIs(output.result[2], image)
        self.assertEqual(len(json.loads(output.result[0])["items"]), 3)
        self.assertEqual(output.result[6][-1], (0, 0, 128, 64))

    def test_invalid_prompt_is_blocked_with_an_explanation(self) -> None:
        sample = json.loads(SAMPLE)
        invalid_prompts = [
            "{",
            "[]",
            json.dumps({**sample, "bbox_format": "xyxy"}),
            json.dumps({**sample, "summary": {**sample["summary"], "meta": "poster"}}),
            json.dumps({**sample, "items": [{"label": "text", "caption": "Title", "bbox": [-100, -100, 100, 100]}]}),
            json.dumps({**sample, "items": [{"label": "", "caption": "Cat", "bbox": [-100, -100, 100, 100]}]}),
        ]
        for prompt in invalid_prompts:
            with self.subTest(prompt=prompt):
                output = moss.NerissMossLayoutPromptEditor.execute(import_json=prompt)
                self.assertIsNotNone(output.block_execution)
        bad_boxes = moss.NerissMossLayoutPromptEditor.execute(bboxes=[(0, 0, -1, 2)], override_bboxes=True)
        self.assertIn("cannot be negative", bad_boxes.block_execution)

    def test_ideogram_export_still_uses_normalized_boxes(self) -> None:
        state = {
            "high_level_description": "A poster",
            "elements": [
                {
                    "type": "text",
                    "bbox": [100, 200, 300, 800],
                    "desc": "Blue title",
                    "text": "探索 🌄",
                    "color_palette": ["#123ABC"],
                },
            ],
        }
        output = ideogram.NerissIdeogramV4PromptEditor.execute(state_json=json.dumps(state), width=1536, height=768)
        self.assertIsNone(output.block_execution)
        prompt = json.loads(output.result[0])
        element = prompt["compositional_deconstruction"]["elements"][0]
        self.assertEqual(element["bbox"], [100, 200, 300, 800])
        self.assertEqual(element["text"], "探索 🌄")
        self.assertEqual(element["color_palette"], ["#123ABC"])
        self.assertNotIn("summary", prompt)
        self.assertEqual(output.result[4:6], (1536, 768))
        imported = ideogram.NerissIdeogramV4PromptEditor.execute(import_json=output.result[0], width=1536, height=768)
        self.assertEqual(json.loads(imported.result[0]), prompt)

    def test_color_library_is_stored_in_the_user_directory(self) -> None:
        layout_editor = importlib.import_module(f"{ROOT.name}.shared.layout_editor")
        library = {"favorites": ["#FF8800", "#FF8800"], "recent": ["#12AB34"]}
        self.assertEqual(
            layout_editor.normalize_color_library(library), {"favorites": ["#FF8800"], "recent": ["#12AB34"]}
        )
        for invalid in ({"favorites": ["#ff8800"], "recent": []}, {"favorites": []}, ["#FF8800"]):
            self.assertIsNone(layout_editor.normalize_color_library(invalid))
        with TemporaryDirectory() as temporary, patch("folder_paths.get_user_directory", return_value=temporary):
            self.assertEqual(
                layout_editor.color_library_path(), Path(temporary) / "Neriss_ComfyNodes" / "editor_colors.json"
            )

    def test_extension_registers_neriss_v3_schemas(self) -> None:
        extension = asyncio.run(package.comfy_entrypoint())
        nodes = asyncio.run(extension.get_node_list())
        schemas = {node.define_schema().node_id: node.define_schema() for node in nodes}
        self.assertEqual(
            set(schemas),
            {
                "Neriss_IdeogramV4PromptEditor",
                "Neriss_MossLayoutPromptEditor",
                "Neriss_ResolutionSelector",
                "Neriss_ScaleImageToMegapixels",
            },
        )
        self.assertTrue(all(schema.category.startswith("Neriss/") for schema in schemas.values()))
        schema = schemas["Neriss_MossLayoutPromptEditor"]
        self.assertFalse(schema.is_experimental)
        self.assertEqual(len(schema.outputs), 7)
        info = moss.NerissMossLayoutPromptEditor.GET_NODE_INFO_V1()
        self.assertEqual(
            info["output_name"], ["json_prompt", "json_pretty", "image", "preview", "width", "height", "bboxes"]
        )
        for field in ("width", "height"):
            options = info["input"]["optional"][field][1]
            self.assertEqual(options["min"], 1)
            self.assertNotIn("max", options)


if __name__ == "__main__":
    unittest.main()
