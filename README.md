# Neriss ComfyNodes

## Install

Use a current ComfyUI installation with the V3 `comfy_api` API.

```sh
cd /path/to/ComfyUI/custom_nodes
git clone https://github.com/NerissG/Neriss_ComfyNodes.git Neriss_ComfyNodes
```

Restart ComfyUI and refresh the browser. The frontend is prebuilt; you do not need Node.js, pnpm or Nix to use the nodes.

To update, run `git pull --ff-only` inside `Neriss_ComfyNodes`, then restart and refresh again.

## Nodes

- **🔨 Ideogram 4 Prompt Editor** — draw object and text regions, describe the scene, and export an Ideogram 4 structured JSON prompt. Supports reference images, palettes and style presets.
- **🔨 MOSS Layout Prompt Editor** — the same visual editor for experimental MOSS-Image-Base layout prompts, with object, character and text regions. Every region needs a bounding box before export.
- **🔨 Resolution Selector** — calculate width and height from an aspect-ratio preset or custom ratio, using a megapixel target or square-side target. Supports flipping and rounding to a chosen multiple.
- **🔨 Scale Image to Megapixels** — resize an image batch to a megapixel or square-side target, with selectable interpolation, optional cropping and mask resizing.

On either prompt node, click **Open Layout Editor**. Connect `json_prompt` to your model's prompt input and use the node's `width` and `height` for generation. Both editors also output a reference/grid image, an annotated preview and pixel bounding boxes.

## Development

Keep the checkout under `ComfyUI/custom_nodes`. Use ComfyUI's Python environment, Node.js 24 and pnpm 12.9.0. On Linux, `nix develop path:.` supplies the frontend/browser tools only; it does not activate or modify your Python environment.

Install the development dependencies and start Vite:

```sh
# From this directory, activate ComfyUI's Python environment first:
source ../../.venv/bin/activate
python -m pip install ruff ty
cd web
pnpm install --frozen-lockfile
pnpm dev
```

In another terminal, start ComfyUI from its own directory:

```sh
WEB_DEV=1 python main.py
```

Open <http://127.0.0.1:8188>. Frontend edits hot-reload from Vite on port 5173; Python changes require a ComfyUI restart. If you use a different browser URL, set it when starting Vite, for example `COMFY_ORIGIN=http://localhost:8188 pnpm dev`.

For standalone UI work, run `pnpm run preview:editor` from `web/` and open <http://127.0.0.1:4179/preview/index.html>. This uses a mock node; uploads and saved libraries need ComfyUI or test mocks.

### Checks

From the repository root, using ComfyUI's Python:

```sh
python -m ruff format .
python -m ruff check .
python -m ty check
python -m unittest discover -s tests -v
```

From `web/`:

```sh
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:release
```

For editor interaction changes, also run `pnpm run test:e2e`. It enters the pinned Nix browser environment automatically; Nix must be installed. Use `pnpm run test:e2e --preflight` to check that environment without running the full suite.

CI runs the frontend checks, Python checks/tests against a pinned real ComfyUI checkout on CPU, and browser tests using this repository's pinned Nix Chromium. The registry publishing workflow requires those checks to pass. This is a regression baseline, not a broader Python/platform support guarantee.

### Production builds

Run `pnpm run build` from `web/` and commit the updated `web/dist` files and root `THIRD_PARTY_NOTICES.md` with your source changes. The build regenerates dependency notices in both locations; deleting `dist` does not delete the root copy. `pnpm run check:release` and CI reject missing or stale output/notices without rewriting them.

Restart ComfyUI **without** `WEB_DEV=1` to use the production build.

### Release versions

From `web/`, run `pnpm run version:bump patch` (or `minor`, `major`, or an explicit
version such as `0.2.0`). The command updates `pyproject.toml`, `uv.lock` and
`web/package.json` together without committing, tagging or publishing. Versions
must be plain `X.Y.Z` releases and must increase. Release checks reject metadata
that has drifted out of sync. Review and stage all three files, then use a matching
`vX.Y.Z` tag when ready to publish.

Licensed under [MPL-2.0](LICENSE). Bundled dependency licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Distribute the editable source and both license/notice files with releases.
