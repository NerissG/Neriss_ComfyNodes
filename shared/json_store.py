"""Bounded JSON reads, validated atomic replacement and optimistic concurrency."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from typing import TypeVar

from aiohttp import web

from . import EditorError, Err, Ok, Result, editor_errors
from .limits import MAX_JSON_BYTES

T = TypeVar("T")
_write_lock = RLock()


def revision(value: object) -> str:
    content = json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def parse_json(content: str | bytes) -> Result[object, EditorError]:
    try:
        if (
            len(content) > MAX_JSON_BYTES
            or len(content.encode("utf-8") if isinstance(content, str) else content) > MAX_JSON_BYTES
        ):
            return Err(editor_errors.runtime("JSON exceeds the 2 MiB limit", {"status": 413}))
        return Ok(json.loads(content))
    except (ValueError, UnicodeError, RecursionError) as error:
        return Err(editor_errors.runtime("Invalid or excessively nested JSON", {"status": 400}, error))


async def request_json(request: web.Request) -> Result[object, EditorError]:
    content = bytearray()
    async for chunk in request.content.iter_chunked(64 * 1024):
        content.extend(chunk)
        if len(content) > MAX_JSON_BYTES:
            return Err(editor_errors.runtime("JSON exceeds the 2 MiB limit", {"status": 413}))
    return parse_json(bytes(content))


def load_store(path: Path, default: Callable[[], T], validate: Callable[[object], T | None]) -> Result[T, EditorError]:
    try:
        with path.open("rb") as file:
            content = file.read(MAX_JSON_BYTES + 1)
    except FileNotFoundError:
        return Ok(default())
    except OSError as error:
        return Err(editor_errors.runtime(f"Could not read {path.name}; file has not been replaced", cause=error))
    parsed = parse_json(content)
    if isinstance(parsed, Err):
        return Err(editor_errors.runtime(f"{path.name} is unreadable; file has not been replaced", cause=parsed.error))
    value = validate(parsed.value)
    if value is None:
        return Err(editor_errors.runtime(f"{path.name} is invalid; file has not been replaced"))
    return Ok(value)


def save_store(
    path: Path,
    value: T,
    default: Callable[[], T],
    validate: Callable[[object], T | None],
    expected: str | None = None,
) -> Result[T, EditorError]:
    validated = validate(value)
    if validated is None:
        return Err(editor_errors.runtime("Invalid stored JSON payload", {"status": 400}))
    with _write_lock:
        previous = load_store(path, default, validate)
        if isinstance(previous, Err):
            return previous
        if expected is not None and expected != revision(previous.value):
            return Err(editor_errors.runtime("Library changed in another tab; reload before saving", {"status": 409}))
        try:
            content = json.dumps(validated, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
            if len(content.encode("utf-8")) > MAX_JSON_BYTES:
                return Err(editor_errors.runtime("JSON exceeds the 2 MiB limit", {"status": 413}))
            path.parent.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(prefix=".neriss-json-", dir=path.parent) as directory:
                temporary = Path(directory) / path.name
                with temporary.open("w", encoding="utf-8") as file:
                    file.write(content)
                    file.flush()
                    os.fsync(file.fileno())
                temporary.replace(path)
        except (OSError, ValueError, UnicodeError) as error:
            return Err(editor_errors.runtime(f"Could not save {path.name}; previous file retained", cause=error))
    return Ok(validated)


def store_response(result: Result[T, EditorError], error_status: int = 500) -> web.Response:
    if isinstance(result, Err):
        status = (result.error.details or {}).get("status", error_status)
        return web.json_response(
            {"error": str(result.error)}, status=status if isinstance(status, int) else error_status
        )
    return web.json_response(result.value, headers={"ETag": revision(result.value)})
