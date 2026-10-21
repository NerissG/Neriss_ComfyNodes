"""Resource budgets for untrusted editor input and image processing."""

from __future__ import annotations

import math
import os

from . import EditorError, Err, Ok, Result, editor_errors

MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_TEXT_LENGTH = 65_536
MAX_REGIONS = 2048
MAX_PRESETS = 256
MAX_COLORS = 1024
MAX_TAGS = 256
MAX_SAFE_INTEGER = 2**53 - 1


def finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    # Avoid overflowing the conversion before testing finiteness.
    if abs(value) > MAX_SAFE_INTEGER:
        return None
    return float(value) if math.isfinite(value) else None


def configured_limit(name: str, default: int) -> Result[int, EditorError]:
    value = os.environ.get(name, str(default))
    if not value.isascii() or not value.isdecimal() or len(value) > 16 or int(value) < 1:
        return Err(editor_errors.runtime(f"{name} must be a positive integer"))
    return Ok(int(value))


def image_budget(width: int, height: int, batch: int = 1) -> Result[None, EditorError]:
    if min(width, height, batch) < 1:
        return Err(editor_errors.runtime("Image dimensions and batch size must be positive"))
    pixels_limit = configured_limit("NERISS_MAX_IMAGE_PIXELS", 64 * 1024 * 1024)
    memory_limit = configured_limit("NERISS_MAX_IMAGE_WORKING_BYTES", 2 * 1024**3)
    if isinstance(pixels_limit, Err):
        return pixels_limit
    if isinstance(memory_limit, Err):
        return memory_limit
    pixels = width * height * batch
    if pixels > pixels_limit.value or pixels * 48 > memory_limit.value:
        return Err(
            editor_errors.runtime(
                "Image exceeds the configured pixel or estimated working-memory budget "
                "(NERISS_MAX_IMAGE_PIXELS / NERISS_MAX_IMAGE_WORKING_BYTES)"
            )
        )
    return Ok(None)
