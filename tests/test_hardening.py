"""Permanent regression coverage for node, HTTP and persistence hardening."""

from __future__ import annotations

import errno
import io
import json
import os
import threading
import unittest
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import torch
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from comfy_test_support import ROOT, ideogram, layout, limits, moss, resize, ui_settings
from PIL import Image


@dataclass(frozen=True)
class StoreCase:
    endpoint: str
    path: Callable[[], Path]
    first: dict[str, object]
    second: dict[str, object]


class StoreRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for name, path in (("get_user_directory", self.root / "user"), ("get_input_directory", self.root / "input")):
            patcher = patch.object(layout.folder_paths, name, return_value=str(path))
            patcher.start()
            self.addCleanup(patcher.stop)
        app = web.Application()
        app.add_routes(layout.routes)
        self.client = await self.enterAsyncContext(TestClient(TestServer(app)))
        style = dict(layout.DEFAULT_STYLE)
        self.stores = (
            StoreCase(
                "/neriss_comfynodes/editor/colors",
                layout.color_library_path,
                {"favorites": ["#123ABC"], "recent": []},
                {"favorites": ["#FFFFFF"], "recent": ["#123ABC"]},
            ),
            StoreCase(
                "/neriss_comfynodes/ideogram/style_presets",
                ideogram.style_presets_path,
                {"presets": [{"id": "first", "name": "First", "style": style}]},
                {"presets": [{"id": "second", "name": "Second", "style": style}]},
            ),
            StoreCase(
                "/neriss_comfynodes/resolution/presets",
                lambda: self.root / "user/Neriss_ComfyNodes/resolution_presets.json",
                {"presets": [{"name": "Portrait", "x": 9, "y": 16}]},
                {"presets": [{"name": "Wide", "x": 16, "y": 9}]},
            ),
            StoreCase(
                "/neriss_comfynodes/ui/settings",
                ui_settings.ui_settings_path,
                {"version": 1, "editor": {"sidebarWidth": 450, "shortcuts": {}}},
                {"version": 1, "editor": {"sidebarWidth": 500, "shortcuts": {}}},
            ),
        )

    async def test_every_store_rejects_stale_writes_and_accepts_a_reviewed_revision(self) -> None:
        for store in self.stores:
            with self.subTest(endpoint=store.endpoint):
                response = await self.client.get(store.endpoint)
                self.assertEqual(response.status, 200)
                original_revision = response.headers["ETag"]
                self.assertFalse(store.path().exists())
                response = await self.client.post(
                    store.endpoint, json=store.first, headers={"If-Match": original_revision}
                )
                self.assertEqual(response.status, 200)
                saved_revision = response.headers["ETag"]
                self.assertNotEqual(original_revision, saved_revision)
                original = store.path().read_bytes()
                response = await self.client.post(
                    store.endpoint, json=store.second, headers={"If-Match": original_revision}
                )
                self.assertEqual(response.status, 409)
                self.assertIn("reload", (await response.json())["error"].lower())
                self.assertEqual(store.path().read_bytes(), original)
                response = await self.client.get(store.endpoint)
                self.assertEqual(await response.json(), store.first)
                self.assertEqual(response.headers["ETag"], saved_revision)
                response = await self.client.post(
                    store.endpoint, json=store.second, headers={"If-Match": saved_revision}
                )
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.json(), store.second)
                self.assertEqual(json.loads(store.path().read_bytes()), store.second)

    async def test_failed_replace_and_full_disk_preserve_all_previous_files(self) -> None:
        for store in self.stores:
            response = await self.client.post(store.endpoint, json=store.first)
            self.assertEqual(response.status, 200)
            original = store.path().read_bytes()
            before = set(store.path().parent.iterdir())
            for target, name, failure in (
                (Path, "replace", PermissionError("Read-only destination")),
                (os, "fsync", OSError(errno.ENOSPC, "Disk full")),
            ):
                with (
                    self.subTest(endpoint=store.endpoint, operation=name),
                    patch.object(target, name, side_effect=failure),
                ):
                    response = await self.client.post(store.endpoint, json=store.second)
                    self.assertEqual(response.status, 500)
                self.assertEqual(store.path().read_bytes(), original)
                self.assertEqual(set(store.path().parent.iterdir()), before)

    async def test_corrupt_invalid_utf8_and_oversized_files_are_never_replaced(self) -> None:
        for store in self.stores:
            for content in (b"{broken", b"\xff\xfe", b"[]", b" " * (limits.MAX_JSON_BYTES + 1)):
                with self.subTest(endpoint=store.endpoint, content=content[:20]):
                    path = store.path()
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                    response = await self.client.get(store.endpoint)
                    self.assertEqual(response.status, 500)
                    response = await self.client.post(store.endpoint, json=store.first)
                    self.assertEqual(response.status, 500)
                    self.assertEqual(path.read_bytes(), content)

    async def test_invalid_and_oversized_requests_do_not_create_store_files(self) -> None:
        for store in self.stores:
            for content, status in (
                (b"{broken", 400),
                (b"\xff", 400),
                (b"[" * 2000 + b"]" * 2000, 400),
                (b"{}", 400),
                (b" " * (limits.MAX_JSON_BYTES + 1), 413),
            ):
                with self.subTest(endpoint=store.endpoint, status=status, content=content[:20]):
                    response = await self.client.post(store.endpoint, data=io.BytesIO(content))
                    self.assertEqual(response.status, status)
                    self.assertFalse(store.path().exists())

    async def test_invalid_library_entries_are_rejected(self) -> None:
        for endpoint, payload in (
            ("resolution/presets", {"presets": [{"name": "Too wide", "x": 100001, "y": 1}]}),
            ("resolution/presets", {"presets": [{"name": "Same", "x": 1, "y": 1}] * 2}),
            ("ideogram/style_presets", {"presets": [{"nonsense": True}]}),
            ("editor/colors", {"favorites": ["not a color"], "recent": []}),
        ):
            with self.subTest(endpoint=endpoint):
                response = await self.client.post(f"/neriss_comfynodes/{endpoint}", json=payload)
                self.assertEqual(response.status, 400)


def png_bytes() -> bytes:
    content = io.BytesIO()
    Image.new("RGBA", (8, 4), (30, 60, 90, 128)).save(content, format="PNG")
    return content.getvalue()


def image_upload(content: bytes) -> FormData:
    form = FormData()
    form.add_field("image", content, filename="reference.png", content_type="image/png")
    return form


class ReferenceRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patcher = patch.object(layout.folder_paths, "get_input_directory", return_value=directory.name)
        patcher.start()
        self.addCleanup(patcher.stop)
        app = web.Application()
        app.add_routes(layout.routes)
        self.client = await self.enterAsyncContext(TestClient(TestServer(app)))
        self.endpoint = "/neriss_comfynodes/editor/reference_image"

    async def test_png_roundtrip_runs_processing_off_the_event_loop(self) -> None:
        threads: list[int] = []
        original = layout.store_reference_image

        def store(content: bytes, filename: str) -> object:
            threads.append(threading.get_ident())
            return original(content, filename)

        with patch.object(layout, "store_reference_image", side_effect=store):
            response = await self.client.post(self.endpoint, data=image_upload(png_bytes()))
        self.assertEqual(response.status, 200)
        image = await response.json()
        self.assertEqual((image["width"], image["height"]), (8, 4))
        self.assertEqual(len(threads), 1)
        self.assertNotEqual(threads[0], threading.get_ident())
        response = await self.client.get(self.endpoint, params={"path": image["path"]})
        self.assertEqual(response.status, 200)
        with Image.open(io.BytesIO(await response.read())) as saved:
            self.assertEqual((saved.format, saved.mode, saved.size), ("PNG", "RGB", (8, 4)))
        self.assertEqual(len(list(self.root.rglob("*.png"))), 1)

    async def test_compressed_pixel_and_memory_limits_reject_before_conversion(self) -> None:
        for variable, limit, status in (
            ("NERISS_MAX_REFERENCE_BYTES", "10", 413),
            ("NERISS_MAX_IMAGE_PIXELS", "31", 400),
            ("NERISS_MAX_IMAGE_WORKING_BYTES", "1535", 400),
        ):
            with (
                self.subTest(variable=variable),
                patch.dict(os.environ, {variable: limit}),
                patch.object(Image.Image, "convert", side_effect=AssertionError("Converted before checking budget")),
            ):
                response = await self.client.post(self.endpoint, data=image_upload(png_bytes()))
                self.assertEqual(response.status, status)
                self.assertEqual(list(self.root.iterdir()), [])

    async def test_invalid_bomb_and_failed_save_leave_no_reference_files(self) -> None:
        response = await self.client.post(self.endpoint, data=image_upload(b"not an image"))
        self.assertEqual(response.status, 400)
        for target, name, failure in (
            (Image, "open", Image.DecompressionBombError("Oversized image")),
            (Image.Image, "save", OSError(errno.ENOSPC, "Disk full")),
        ):
            content = png_bytes()
            with self.subTest(operation=name), patch.object(target, name, side_effect=failure):
                response = await self.client.post(self.endpoint, data=image_upload(content))
                self.assertEqual(response.status, 400)
            self.assertEqual(list(self.root.rglob("*.png")), [])
            self.assertFalse(any(path.name.startswith(".reference-") for path in self.root.rglob("*")))

    async def test_reference_paths_cannot_escape_the_reference_directory(self) -> None:
        for path in ("/etc/passwd", "../outside.png", "Neriss_ComfyNodes/reference_images/../../outside.png"):
            response = await self.client.get(self.endpoint, params={"path": path})
            self.assertEqual(response.status, 404)
        root = self.root / layout.REFERENCE_IMAGE_DIR
        root.mkdir(parents=True)
        outside = self.root / "outside.png"
        outside.write_bytes(png_bytes())
        (root / "escape.png").symlink_to(outside)
        response = await self.client.get(
            self.endpoint, params={"path": "Neriss_ComfyNodes/reference_images/escape.png"}
        )
        self.assertEqual(response.status, 404)


class NodeHardeningTests(unittest.TestCase):
    def test_tiny_extreme_crop_never_creates_an_empty_slice(self) -> None:
        for height, width in ((1, 100), (100, 1)):
            for position in resize.CROP_POSITIONS:
                with self.subTest(size=(height, width), position=position):
                    output = resize.NerissScaleImageToMegapixels.execute(
                        image=torch.zeros((1, height, width, 3)),
                        mask=torch.ones((height, width)),
                        upscale_method="bilinear",
                        mode="megapixels",
                        megapixels=0.01,
                        squared=1024,
                        resolution_steps=256,
                        keep_proportion="crop",
                        crop_position=position,
                    )
                    self.assertIsNone(output.block_execution)
                    self.assertGreater(min(output.result[0].shape), 0)
                    self.assertEqual(tuple(output.result[3].shape), tuple(output.result[0].shape[:3]))

    def test_resize_methods_preserve_batches_broadcast_masks_and_do_not_mutate_inputs(self) -> None:
        image = torch.rand((2, 12, 20, 3))
        mask = torch.rand((12, 20))
        before_image, before_mask = image.clone(), mask.clone()
        for method in resize.UPSCALE_METHODS:
            for proportion in resize.KEEP_PROPORTION_MODES:
                with self.subTest(method=method, proportion=proportion):
                    output = resize.NerissScaleImageToMegapixels.execute(
                        image=image,
                        mask=mask,
                        upscale_method=method,
                        mode="squared",
                        megapixels=1.0,
                        squared=64,
                        resolution_steps=16,
                        keep_proportion=proportion,
                        crop_position="center",
                    )
                    self.assertIsNone(output.block_execution)
                    result, width, height, resized_mask = output.result
                    self.assertEqual(tuple(result.shape), (2, height, width, 3))
                    self.assertEqual(tuple(resized_mask.shape), (2, height, width))
                    self.assertTrue(torch.isfinite(result).all())
                    self.assertTrue(torch.isfinite(resized_mask).all())
        self.assertTrue(torch.equal(image, before_image))
        self.assertTrue(torch.equal(mask, before_mask))

    def test_reference_previews_preserve_every_frame_device_and_dtype(self) -> None:
        for node in (ideogram.NerissIdeogramV4PromptEditor, moss.NerissMossLayoutPromptEditor):
            for dtype in (torch.float16, torch.float32, torch.float64):
                with self.subTest(node=node.__name__, dtype=dtype):
                    image = torch.zeros((2, 8, 12, 3), dtype=dtype)
                    image[1] = 1
                    original = image.clone()
                    output = node.execute(reference_image=image, override_image=True)
                    self.assertIsNone(output.block_execution)
                    self.assertIs(output.result[2], image)
                    preview = output.result[3]
                    self.assertEqual(preview.shape, image.shape)
                    self.assertEqual((preview.device, preview.dtype), (image.device, dtype))
                    self.assertTrue(torch.equal(preview[0], image[0]))
                    self.assertTrue(torch.equal(preview[1], image[1]))
                    self.assertTrue(torch.equal(image, original))

    def test_resize_uses_decimal_megapixels(self) -> None:
        output = resize.NerissScaleImageToMegapixels.execute(
            image=torch.zeros((1, 2, 2, 3)),
            upscale_method="nearest-exact",
            mode="megapixels",
            megapixels=1,
            squared=1024,
            resolution_steps=1,
            keep_proportion="stretch",
            crop_position="center",
        )
        self.assertEqual(output.result[1:3], (1000, 1000))

    def test_budget_rejections_happen_before_tensor_allocation_or_upscaling(self) -> None:
        image = torch.zeros((2, 8, 8, 3))
        for variable in ("NERISS_MAX_IMAGE_PIXELS", "NERISS_MAX_IMAGE_WORKING_BYTES"):
            with self.subTest(variable=variable), patch.dict(os.environ, {variable: "1"}):
                with patch.object(layout.torch, "full", side_effect=AssertionError("Allocated oversized image")):
                    self.assertIsNotNone(
                        ideogram.NerissIdeogramV4PromptEditor.execute(width=8, height=8).block_execution
                    )
                with patch.object(resize, "common_upscale", side_effect=AssertionError("Upscaled oversized image")):
                    output = resize.NerissScaleImageToMegapixels.execute(
                        image=image,
                        upscale_method="bilinear",
                        mode="squared",
                        megapixels=1,
                        squared=64,
                        resolution_steps=1,
                        keep_proportion="stretch",
                        crop_position="center",
                    )
                    self.assertIsNotNone(output.block_execution)

    def test_saved_reference_limits_and_bombs_are_handled_before_conversion(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "reference.png"
            path.write_bytes(png_bytes())
            with (
                patch.object(layout, "reference_image_path", return_value=path),
                patch.dict(os.environ, {"NERISS_MAX_IMAGE_PIXELS": "16"}),
                patch.object(Image.Image, "convert", side_effect=AssertionError("Converted oversized reference")),
            ):
                output = ideogram.NerissIdeogramV4PromptEditor.execute(
                    state_json=json.dumps({"reference_image_path": "reference.png"}),
                    width=2,
                    height=2,
                )
                self.assertIsNotNone(output.block_execution)
            with (
                patch.object(layout, "reference_image_path", return_value=path),
                patch.object(Image, "open", side_effect=Image.DecompressionBombError("Oversized saved reference")),
            ):
                output = ideogram.NerissIdeogramV4PromptEditor.execute(
                    state_json=json.dumps({"reference_image_path": "reference.png"}),
                    width=2,
                    height=2,
                )
                self.assertIsNotNone(output.block_execution)

    def test_huge_and_nonfinite_coordinates_fail_without_overflow(self) -> None:
        for coordinate in (10**400, float("inf"), float("nan"), True):
            for node in (ideogram.NerissIdeogramV4PromptEditor, moss.NerissMossLayoutPromptEditor):
                with self.subTest(node=node.__name__, coordinate=coordinate):
                    output = node.execute(
                        state_json=json.dumps(
                            {"elements": [{"id": "a", "type": "obj", "bbox": [0, 0, coordinate, coordinate]}]}
                        ),
                        width=2,
                        height=2,
                    )
                    self.assertIsNotNone(output.block_execution)

    def test_shared_validation_cases_match_frontend_expectations(self) -> None:
        cases = json.loads((ROOT / "tests/fixtures/hardening_validation.json").read_text())
        for case in cases:
            for node in (ideogram.NerissIdeogramV4PromptEditor, moss.NerissMossLayoutPromptEditor):
                if case["kind"] != "state" and case["kind"] != (
                    "ideogram" if node is ideogram.NerissIdeogramV4PromptEditor else "moss"
                ):
                    continue
                with self.subTest(case=case["name"], node=node.__name__):
                    argument = "state_json" if case["kind"] == "state" else "import_json"
                    output = node.execute(**{argument: json.dumps(case["value"])}, width=8, height=8)
                    self.assertEqual(output.block_execution is None, case["valid"])


if __name__ == "__main__":
    unittest.main()
