"""UI-only preferences, stored beside the editor color library in Comfy's user directory."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypedDict

import folder_paths
from aiohttp import web

from . import EditorError, Err, Ok, Result, editor_errors
from .json_store import parse_json, request_json, revision, store_response
from .limits import MAX_JSON_BYTES


class KeyBinding(TypedDict):
    key: str
    modifiers: list[str]


class EditorPreferences(TypedDict):
    sidebarWidth: int
    shortcuts: dict[str, list[KeyBinding]]


class UiSettings(TypedDict):
    version: int
    editor: EditorPreferences


DEFAULT_BINDINGS: dict[str, list[KeyBinding]] = {
    "tool.select": [{"key": "v", "modifiers": []}],
    "tool.object": [{"key": "o", "modifiers": []}],
    "tool.character": [{"key": "c", "modifiers": []}],
    "tool.text": [{"key": "t", "modifiers": []}],
    "tool.pan": [{"key": "h", "modifiers": []}],
    "history.undo": [{"key": "z", "modifiers": ["Mod"]}],
    "history.redo": [{"key": "z", "modifiers": ["Mod", "Shift"]}, {"key": "y", "modifiers": ["Mod"]}],
    "selection.delete": [{"key": "delete", "modifiers": []}, {"key": "backspace", "modifiers": []}],
    "view.focus": [{"key": "f", "modifiers": []}],
    "view.fitCanvas": [{"key": "0", "modifiers": []}],
    "view.zoomSelection": [{"key": "1", "modifiers": []}],
    "view.toggleSidebar": [{"key": "\\", "modifiers": []}],
    "panel.regions": [{"key": "1", "modifiers": ["Alt"]}],
    "panel.scene": [{"key": "2", "modifiers": ["Alt"]}],
    "panel.canvas": [{"key": "3", "modifiers": ["Alt"]}],
    **{
        f"canvas.{direction}{suffix}": [{"key": f"arrow{direction}", "modifiers": modifiers}]
        for direction in ("left", "right", "up", "down")
        for suffix, modifiers in (("", []), ("Fast", ["Shift"]))
    },
}
MODIFIERS = {"Mod", "Control", "Meta", "Alt", "Shift"}
NAMED_KEYS = {
    "backspace",
    "delete",
    "arrowleft",
    "arrowright",
    "arrowup",
    "arrowdown",
    "home",
    "end",
    "pageup",
    "pagedown",
}


def default_ui_settings() -> UiSettings:
    return {"version": 1, "editor": {"sidebarWidth": 390, "shortcuts": {}}}


def ui_settings_path() -> Path:
    return Path(folder_paths.get_user_directory()) / "Neriss_ComfyNodes" / "ui_settings.json"


def normalize_binding(value: object) -> Result[KeyBinding, EditorError]:
    invalid = Err(editor_errors.runtime("Invalid shortcut binding"))
    if not isinstance(value, dict) or set(value) != {"key", "modifiers"}:
        return invalid
    key, modifiers = value.get("key"), value.get("modifiers")
    if not isinstance(key, str) or not (
        (len(key) == 1 and key.isprintable() and not key.isspace() and key == key.lower())
        or key in NAMED_KEYS
        or re.fullmatch(r"f([1-9]|1[0-2])", key)
    ):
        return Err(editor_errors.runtime("Escape, Tab, Enter, Space and modifier-only keys are reserved"))
    if not isinstance(modifiers, list) or len(modifiers) > 4:
        return invalid
    normalized: list[str] = []
    for modifier in modifiers:
        if not isinstance(modifier, str) or modifier not in MODIFIERS or modifier in normalized:
            return invalid
        normalized.append(modifier)
    if "Mod" in normalized and ("Control" in normalized or "Meta" in normalized):
        return invalid
    primary = bool({"Mod", "Control", "Meta"}.intersection(normalized))
    if (
        (primary and key in {"a", "c", "v", "x", "w", "t", "n", "r", "l", "q"})
        or key in {"f1", "f5", "f6", "f11", "f12"}
        or ("Alt" in normalized and key in {"arrowleft", "arrowright", "f4"})
    ):
        return Err(
            editor_errors.runtime("Shortcut is reserved for native editing, the browser or the operating system")
        )
    return Ok({"key": key, "modifiers": normalized})


def normalize_ui_settings(value: object) -> Result[UiSettings, EditorError]:
    invalid = Err(editor_errors.runtime("Invalid UI settings file"))
    if not isinstance(value, dict) or set(value) - {"version", "editor"}:
        return invalid
    if type(value.get("version")) is not int or value.get("version") != 1:
        return Err(editor_errors.runtime("Unsupported UI settings version (expected 1)"))
    editor = value.get("editor", {})
    if not isinstance(editor, dict) or set(editor) - {"sidebarWidth", "shortcuts"}:
        return invalid
    width = editor.get("sidebarWidth", 390)
    if not isinstance(width, int) or isinstance(width, bool) or not 300 <= width <= 720:
        return Err(editor_errors.runtime("Sidebar width must be an integer between 300 and 720"))
    overrides = editor.get("shortcuts", {})
    if not isinstance(overrides, dict):
        return invalid
    shortcuts: dict[str, list[KeyBinding]] = {}
    for command, bindings in overrides.items():
        if not isinstance(command, str) or command not in DEFAULT_BINDINGS:
            return Err(editor_errors.runtime("Unknown shortcut command"))
        if not isinstance(bindings, list) or len(bindings) > 4:
            return invalid
        shortcuts[command] = []
        for binding in bindings:
            result = normalize_binding(binding)
            if isinstance(result, Err):
                return result
            shortcuts[command].append(result.value)
    # Editor-wide and canvas commands overlap. Check both platforms so saved
    # preferences remain unambiguous when the same Comfy instance is opened elsewhere.
    for mac in (False, True):
        occupied: dict[tuple[str, tuple[str, ...]], str] = {}
        for command, defaults in DEFAULT_BINDINGS.items():
            for binding in shortcuts.get(command, defaults):
                modifiers = {("Meta" if mac else "Control") if m == "Mod" else m for m in binding["modifiers"]}
                signature = (binding["key"], tuple(sorted(modifiers)))
                if signature in occupied:
                    return Err(editor_errors.runtime(f"Shortcut conflict: {command} and {occupied[signature]}"))
                occupied[signature] = command
    return Ok({"version": 1, "editor": {"sidebarWidth": width, "shortcuts": shortcuts}})


def load_ui_settings() -> Result[UiSettings, EditorError]:
    path = ui_settings_path()
    try:
        with path.open("rb") as file:
            content = file.read(MAX_JSON_BYTES + 1)
    except FileNotFoundError:
        return Ok(default_ui_settings())
    except UnicodeError as error:
        return Err(editor_errors.runtime("UI settings file is unreadable; it has not been replaced", cause=error))
    except OSError as error:
        return Err(editor_errors.runtime("Could not read UI settings", cause=error))
    value = parse_json(content)
    if isinstance(value, Err):
        return Err(editor_errors.runtime("UI settings file is unreadable; it has not been replaced", cause=value.error))
    return normalize_ui_settings(value.value)


def write_ui_settings(settings: UiSettings, expected: str | None = None) -> Result[UiSettings, EditorError]:
    validated = normalize_ui_settings(settings)
    if isinstance(validated, Err):
        return validated
    existing = load_ui_settings()
    if isinstance(existing, Err):
        return existing  # Never replace a corrupt or unsupported existing file.
    if expected is not None and expected != revision(existing.value):
        return Err(editor_errors.runtime("UI settings changed in another tab; reload before saving", {"status": 409}))
    path = ui_settings_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix=".ui-settings-", dir=path.parent) as directory:
            temporary = Path(directory) / path.name
            with temporary.open("w", encoding="utf-8") as file:
                file.write(json.dumps(validated.value, indent=2, ensure_ascii=False) + "\n")
                file.flush()
                os.fsync(file.fileno())
            temporary.replace(path)
    except OSError as error:
        return Err(editor_errors.runtime("Could not save UI settings; changes have not been persisted", cause=error))
    return validated


async def get_ui_settings(_: web.Request) -> web.Response:
    result = load_ui_settings()
    if isinstance(result, Err):
        return web.json_response({"error": str(result.error)}, status=500)
    return web.json_response(result.value, headers={"ETag": revision(result.value)})


async def post_ui_settings(request: web.Request) -> web.Response:
    content = await request_json(request)
    if isinstance(content, Err):
        return store_response(content, 400)
    parsed = normalize_ui_settings(content.value)
    if isinstance(parsed, Err):
        return web.json_response({"error": str(parsed.error)}, status=400)
    saved = write_ui_settings(parsed.value, request.headers.get("If-Match"))
    if isinstance(saved, Err):
        return store_response(saved)
    return web.json_response(saved.value, headers={"ETag": revision(saved.value)})


def register_ui_settings_routes(routes: web.RouteTableDef) -> None:
    routes.get("/neriss_comfynodes/ui/settings")(get_ui_settings)
    routes.post("/neriss_comfynodes/ui/settings")(post_ui_settings)
