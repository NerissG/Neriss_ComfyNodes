from __future__ import annotations

import math

import torch
from comfy.utils import common_upscale
from comfy_api.latest import io

from ..shared import Err
from ..shared.limits import image_budget

UPSCALE_METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]
SIZING_MODES = ["megapixels", "squared"]
KEEP_PROPORTION_MODES = ["stretch", "crop"]
CROP_POSITIONS = ["center", "top", "bottom", "left", "right"]


def calculate_total_pixel_size(
    width: int,
    height: int,
    target_pixels: float,
    resolution_steps: int,
) -> tuple[int, int]:
    scale_by = math.sqrt(target_pixels / (width * height))
    step = max(1, resolution_steps)
    target_width = max(1, round(width * scale_by / step) * step)
    target_height = max(1, round(height * scale_by / step) * step)
    return target_width, target_height


def crop_to_aspect(
    image: torch.Tensor,
    mask: torch.Tensor | None,
    target_width: int,
    target_height: int,
    crop_position: str,
) -> tuple[torch.Tensor, torch.Tensor | None]:
    source_height = image.shape[1]
    source_width = image.shape[2]
    source_aspect = source_width / source_height
    target_aspect = target_width / target_height

    if source_aspect > target_aspect:
        crop_width = max(1, min(source_width, round(source_height * target_aspect)))
        crop_height = source_height
    else:
        crop_width = source_width
        crop_height = max(1, min(source_height, round(source_width / target_aspect)))

    if crop_position == "top":
        x = (source_width - crop_width) // 2
        y = 0
    elif crop_position == "bottom":
        x = (source_width - crop_width) // 2
        y = source_height - crop_height
    elif crop_position == "left":
        x = 0
        y = (source_height - crop_height) // 2
    elif crop_position == "right":
        x = source_width - crop_width
        y = (source_height - crop_height) // 2
    else:
        x = (source_width - crop_width) // 2
        y = (source_height - crop_height) // 2

    cropped_image = image[:, y : y + crop_height, x : x + crop_width, :]
    cropped_mask = None if mask is None else mask[:, y : y + crop_height, x : x + crop_width]
    return cropped_image, cropped_mask


def normalize_mask(mask: torch.Tensor | None, image: torch.Tensor) -> tuple[torch.Tensor | None, str | None]:
    if mask is None:
        return None, None

    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    if mask.ndim != 3 or min(mask.shape) < 1:
        return None, "Expected mask shape [H, W] or [B, H, W]."

    image_batch = image.shape[0]
    if mask.shape[0] == 1 and image_batch > 1:
        mask = mask.expand(image_batch, -1, -1)
    elif mask.shape[0] != image_batch:
        return None, "Mask batch size must be 1 or match image batch size."

    if mask.shape[1] != image.shape[1] or mask.shape[2] != image.shape[2]:
        mask = common_upscale(
            mask.unsqueeze(1),
            image.shape[2],
            image.shape[1],
            "bilinear",
            crop="disabled",
        ).squeeze(1)

    return mask, None


def resize_mask(mask: torch.Tensor, width: int, height: int, upscale_method: str) -> torch.Tensor:
    if upscale_method == "lanczos":
        resized = common_upscale(
            mask.unsqueeze(1).repeat(1, 3, 1, 1),
            width,
            height,
            upscale_method,
            crop="disabled",
        )
        return resized.movedim(1, -1)[:, :, :, 0]
    return common_upscale(mask.unsqueeze(1), width, height, upscale_method, crop="disabled").squeeze(1)


class NerissScaleImageToMegapixels(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Neriss_ScaleImageToMegapixels",
            display_name="🔨 Scale Image to Megapixels",
            category="Neriss/Image",
            description=(
                "Scale an image to target megapixels or a target square side length "
                "with optional aspect-preserving crop behavior."
            ),
            inputs=[
                io.Image.Input("image"),
                io.Mask.Input("mask", optional=True),
                io.Combo.Input(
                    "upscale_method",
                    options=UPSCALE_METHODS,
                    default="nearest-exact",
                ),
                io.Combo.Input(
                    "mode",
                    options=SIZING_MODES,
                    default="megapixels",
                    tooltip=(
                        "megapixels targets total pixels; squared targets a square side length "
                        "(total pixels = squared x squared)."
                    ),
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.01,
                    max=64.0,
                    step=0.01,
                    tooltip="Target total pixels in megapixels (1 MP = 1,000,000 pixels).",
                ),
                io.Int.Input(
                    "squared",
                    default=1024,
                    min=64,
                    max=16384,
                    step=64,
                    tooltip=(
                        "Square side length in pixels; total pixels = squared x squared, "
                        "rounded to the selected resolution step."
                    ),
                ),
                io.Int.Input(
                    "resolution_steps",
                    default=1,
                    min=1,
                    max=256,
                    step=1,
                    tooltip="Round output width and height to this step size.",
                ),
                io.Combo.Input(
                    "keep_proportion",
                    options=KEEP_PROPORTION_MODES,
                    default="stretch",
                    tooltip=(
                        "stretch resizes directly; crop trims the source to the rounded target aspect before resizing."
                    ),
                ),
                io.Combo.Input(
                    "crop_position",
                    options=CROP_POSITIONS,
                    default="center",
                    tooltip="Crop anchor used when keep_proportion is crop.",
                ),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Int.Output("width", display_name="width"),
                io.Int.Output("height", display_name="height"),
                io.Mask.Output("mask", display_name="mask"),
            ],
            search_aliases=["scale image", "resize image", "megapixels", "squared", "total pixels", "crop resize"],
        )

    @classmethod
    # ComfyUI validates these explicit inputs against the schema before execution.
    def execute(  # ty: ignore[invalid-method-override]
        cls,
        image: torch.Tensor,
        upscale_method: str,
        mode: str,
        megapixels: float,
        squared: int,
        resolution_steps: int,
        keep_proportion: str,
        crop_position: str,
        mask: torch.Tensor | None = None,
    ) -> io.NodeOutput:
        if image.ndim != 4 or min(image.shape) < 1 or image.shape[3] not in (1, 3, 4):
            return io.NodeOutput(block_execution="Expected image shape [B, H, W, C].")

        target_pixels = float(squared**2) if mode == "squared" else megapixels * 1_000_000
        output_width, output_height = calculate_total_pixel_size(
            image.shape[2], image.shape[1], target_pixels, resolution_steps
        )
        budget = image_budget(output_width, output_height, image.shape[0])
        if isinstance(budget, Err):
            return io.NodeOutput(block_execution=str(budget.error))
        normalized_mask, mask_error = normalize_mask(mask, image)
        if mask_error is not None:
            return io.NodeOutput(block_execution=mask_error)

        source_image = image
        source_mask = normalized_mask
        if keep_proportion == "crop":
            source_image, source_mask = crop_to_aspect(
                source_image, source_mask, output_width, output_height, crop_position
            )

        output_image = common_upscale(
            source_image.movedim(-1, 1), output_width, output_height, upscale_method, crop="disabled"
        ).movedim(1, -1)
        if source_mask is None:
            output_mask = torch.zeros(
                output_image.shape[0],
                output_height,
                output_width,
                device=output_image.device,
                dtype=output_image.dtype,
            )
        else:
            output_mask = resize_mask(source_mask, output_width, output_height, upscale_method)

        return io.NodeOutput(output_image, output_width, output_height, output_mask)
