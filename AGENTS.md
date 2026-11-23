# Neriss ComfyNodes Guidelines

This repo is a ComfyUI custom node package with Python nodes and a Svelte/TypeScript browser extension under `web/`.

## Project Structure

- Package root: keep focused on package metadata, Comfy entrypoints, web asset exports, and repository-level tooling config.
- `nodes/`: Python ComfyUI node definitions and node-local helpers.
- `shared/`: Python utilities that are reused across multiple node modules, such as result and error primitives.
- `web/`: browser extension project, including Vite/Svelte config, frontend dependencies, source, and built assets.
- `web/src/`: TypeScript/Svelte application source. `extension.ts` registers with Comfy, `App.svelte` mounts the views, and `views.ts` owns which view is open.
- `web/src/comfy/`: Comfy host integration: HTTP transport (`requestJson`), node widgets and node-type hooks, and runtime guards.
- `web/src/ui/`: feature-agnostic Svelte components (`Dialog`, `Icon`, `NumberField`, `SearchInput`, `ToggleGroup`, `Alert`, `AsyncState`) and `theme.css`.
- `web/src/shared/`: feature-agnostic TypeScript utilities such as undo history and bounded JSON parsing.
- `web/src/layout/`, `lora/`, `resolution/`, `settings/`: one folder per feature. Model-specific layout code lives in `layout/ideogram/` and `layout/moss/`.

### Frontend Naming

- Each feature has one view named `<Feature>Editor.svelte` (`LayoutEditor`, `LoraEditor`, `PresetEditor`, `ShortcutEditor`). Modal views render inside `ui/Dialog.svelte` and take an `onclose` callback.
- `*Panel.svelte` is a sidebar or dialog section, `*Field.svelte` a labelled form control, `*Input.svelte` a bare input.
- `api.ts` holds HTTP requests built on `requestJson`, `store.ts` holds Svelte stores, and `state.ts` holds schemas and pure state transforms.
- Reuse `ui/` components and `theme.css` classes (`primary`, `icon-button`, `with-icon`, `empty-state`, `sr-only`) before adding view-local equivalents.

## User Data Access

Code is open; the user's ComfyUI data is not. Paths below are relative to the ComfyUI root (`../../` from this package).

### Allowed Without Asking

- Any source code: this package, ComfyUI core, other custom nodes, and installed Python or Node packages.
- This repository's test fixtures, preview fixtures, and mocks.
- ComfyUI logs: `user/comfyui*.log`.
- Model file names and safetensors tensor headers (keys, shapes, dtypes) under `models/`. Do not read weights or the `__metadata__` block, which can embed workflows or training data.
- Files the user attaches or pastes into the conversation.

### Requires Explicit Permission

- Anything else under `user/`: workflows, templates, `comfy.settings.json`, `comfyui.db`, this package's presets and settings in `user/Neriss_ComfyNodes/`, and other custom nodes' data.
- `input/`, `output/`, and `temp/`: images, masks, videos, and any embedded workflow or prompt metadata.
- Directory listings of the folders above. File names count as user data.
- Writing, moving, or deleting any user data.
- Starting the real ComfyUI server, or opening its UI in a browser, since it loads the user's workflows and writes to `output/`. Unit tests, `pnpm run preview:editor`, and `pnpm run test:e2e` use mocks and stay allowed.

### How to Handle It

- Ask before access and name the exact files or folders and the reason. A grant covers only those paths for the current task; ask again for new paths or a new task.
- Scope searches to code. Exclude `user/`, `input/`, `output/`, and `temp/` from repository-wide `grep`, `rg`, or `find` run from the ComfyUI root.
- If user data shows up by accident, such as in a search hit or a stack trace, do not open it further or quote its content. Tell the user it appeared.
- Reproduce bugs with synthetic fixtures instead of real workflows or images. Ask the user for a minimal sample when a fixture cannot reproduce the issue.

## Python

### Tooling Expectations

Before considering Python work done, run:

- `python -m ruff format .`
- `python -m ruff check .`
- `python -m ty check`

### ComfyUI Nodes

- Use the modern V3 `comfy_api.latest` API for new nodes.
- Keep `__init__.py` focused on package entrypoints and web asset exports.
- Node ids must be globally unique and prefixed with `Neriss_` the name should be prefixed with `🔨 `.

### Python Style

- Keep typing explicit and useful; avoid untyped helper functions.
- Avoid broad exception control flow. Use the local result pattern for expected failures.

### Python Error Handling

- Use `shared.Result`, `Ok`, and `Err` for expected failures.
- Keep error names aligned with the feature or integration being implemented.
- Do not introduce backend-flavored names such as `DomainError`, `InfraError`, or database-oriented errors unless the project actually grows those layers.
- Only use exceptions for truly exceptional/unexpected failures or APIs that require them.

## TypeScript / Svelte

### Tooling Expectations

Before considering frontend work done, run from `web/`:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`

Use `pnpm` for frontend dependency changes.

### Browser Testing

- Run `pnpm run test:e2e` from `web/` for editor interaction changes. The command enters this repository's pinned Nix shell when needed, starts the local preview, checks the environment, and runs Playwright.
- Use `pnpm run test:e2e --preflight` for the environment check alone. `pnpm run test:browser-env` is an equivalent convenience command.
- Use only the browsers supplied by `PLAYWRIGHT_BROWSERS_PATH` in this repository's Nix shell. Keep `@playwright/test` exactly aligned with `PLAYWRIGHT_VERSION` from the pinned Nix package.
- Do not search unrelated repositories or tool caches for browsers, run `playwright install`, patch browser binaries, or assemble ad hoc library paths. If preflight fails, report the missing prerequisite. Fix environment declarations only when that work is authorized.
- If sandbox permissions block the Nix daemon, Chromium, or the loopback server, request escalation for `pnpm run test:e2e` with that exact reusable command prefix. Do not broaden global network or filesystem permissions.
- `pnpm run preview:editor` serves the development preview at `http://127.0.0.1:4179/preview/index.html`. It mounts the real editor with a mock Comfy node; it is not included in the extension build. Image/preset endpoints require explicit test mocks or actual ComfyUI integration checks.
- Screenshots and traces go under `web/test-results/`; the HTML report goes under `web/playwright-report/`. These directories are gitignored.
- Keep preview files and browser tests in the frontend typecheck and lint scope. Browser checks complement the required lint, typecheck, unit tests, and production build.

### TypeScript Quality Bar

- Treat TypeScript as the primary correctness tool.
- Never use `any`. If it seems unavoidable, ask first.
- Never use `as` casts. If it seems unavoidable, ask first.
- Input validation should be done with zod v4.
- Keep Comfy runtime values behind narrow local types and guards.

### Frontend Error Handling

- Use `neverthrow` (`Result` / `ResultAsync`) for expected application flow.
- Do not use `try/catch` or `throw` for control flow.
- Keep error names aligned with the feature or integration being implemented.
- Do not introduce overly specific error taxonomies until the feature area needs them.
- Prefer `ResultAsync.fromPromise`, `ok`, `err`, `okAsync`, `errAsync`, and `mapErr` over thrown errors.

## Additional Informations

- Prefer forward-only, clean, readable implementation.
- NEVER try to "preserve workflows saved during the earlier implementation" through backward compatibility, write clean solutions instead.
- Backward compatibility is not the default. Only preserve legacy behavior when the user asks for it, when a public external API contract requires it, or when the task explicitly says to provide a migration path. Otherwise, remove the old path and keep the implementation single-path.
