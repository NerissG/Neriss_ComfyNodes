# Public-release audit follow-up

This is the implementation/deferment record for the public-release audit. Audit
notes and unfinished work belong here, not in `README.md` or `AGENTS.md`.

## Explicitly deferred

These decisions are intentional; do not treat them as authorization to implement
the deferred work.

- **4.2 — Account isolation:** keep installation-wide storage for now. UI settings,
  resolution presets and colors live below the configured Comfy user-directory
  root at `Neriss_ComfyNodes/`, not below a requesting account's directory. Style
  presets and reference images live in the shared input directory. No additional
  authentication or per-account storage layer has been added. Access protection
  remains the host/proxy's responsibility; this is not an Internet-hosting
  security guarantee. Request-scoped storage and isolation tests are future work.
- **4.3 — Reference lifecycle:** retained files are expected. Every upload creates
  a new PNG under `<input>/Neriss_ComfyNodes/reference_images/`. Removing an image
  from the editor removes only the state pointer. There is no automatic deletion,
  quota, garbage collection, or transfer/export bundle. Workflows, other nodes
  and undo history may still refer to retained files. Operators manage storage
  and backups manually. Cleanup/transfer tooling remains deferred.
- **5.1 — Remote plain HTTP:** no fallback for missing secure-context clipboard
  APIs or `crypto.randomUUID()` has been added. HTTPS/loopback behavior remains
  distinct from remote plain HTTP. Browser feature detection, graceful fallback
  and an alternative to clipboard-based prompt import/export remain deferred.
- **5.3 — Compatibility:** no new minimum ComfyUI/frontend version, Python support
  claim, browser matrix or operating-system guarantee has been established.
  `comfy_api.latest` remains in use. Existing Python metadata is unchanged; its
  complete advertised range has not been verified. Version/platform validation,
  real-frontend integration and any resulting compatibility metadata are later
  work. The existing Node/pnpm pins remain development requirements, not a new
  compatibility promise.
- **7 — Public-user documentation:** no README expansion, installation tutorial,
  four-node catalog, example workflows, screenshots, generation wiring, BBOX/batch
  guide, transfer/backup/uninstall guide, troubleshooting guide, security contact,
  contribution guide, issue templates or support/changelog policy is being added
  in this pass. These remain public-release follow-ups.
- **9 — Expanded testing:** the remaining broader programme is deferred:
  clean artifact installation; actual frontend registration, node creation,
  save/reload/queue; real endpoint integration in the browser; broader resize,
  cross-installation regression expansion and version/platform matrices. Permanent
  hardening regressions, mask/batch checks, persistence fault injection and Python
  plus pinned-browser CI have now been added in the follow-up below. This does not
  claim complete interpolation/device/platform or real-frontend coverage.

## Implemented in the section 1 commit

Commit `3c67328` supplied committed production assets, generated complete bundled
dependency notices, source/asset consistency checks, and portable resolution
snapshots. Those changes are retained rather than reimplemented.

## Remaining owner/release actions

- [ ] Confirm rights/provenance for all contributed code, copied icon paths,
  examples and future screenshots. A secret scan cannot establish copyright
  ownership. MPL-2.0 remains the project license.
- [x] Start the publication checkout with a fresh Git repository rather than
  carrying over the private history. The sanity check found no commits, refs or
  reflogs from the old repository; the staged publication snapshot passed Gitleaks.
  This does not erase any previously shared copies or revoke exposed credentials.
- [ ] Confirm the author name/email intended for the first public commit and
  rotate any previously exposed credentials before publishing.
- [ ] Decide and register the immutable Comfy Registry publisher identity and
  confirm package-name availability. Then set `[tool.comfy].PublisherId`;
  deliberately no guessed publisher has been committed.
- [ ] Configure a `comfy-registry` GitHub environment, required approval rules and
  the `REGISTRY_ACCESS_TOKEN` secret. The manual publishing workflow accepts only
  a `v<project.version>` tag and refuses missing publisher metadata. No account,
  secret, environment, tag or public release has been created by this work.
- [ ] Review the eventual registry-generated archive and complete a clean install
  before publishing. Committed assets and `.comfyignore` are configured, but an
  actual registry publication has not occurred. Keep `LICENSE`, root notices,
  `web/dist` notices and editable frontend/Python sources in the distribution.
- [ ] Complete the explicitly deferred compatibility, public-user documentation
  and testing work before advertising corresponding support guarantees.
- [ ] Audit the independently installed ComfyUI/Python host dependencies if that
  is part of the intended release/security assurance. Frontend dependency checks
  do not audit that environment.

## Persistence behavior

Stored JSON reads and HTTP JSON bodies are limited to 2 MiB. Style and resolution
libraries support up to 256 presets, colors up to 1024 entries per collection,
layouts up to 2048 regions, metadata up to 256 tags, and individual text fields up
to 65,536 characters. Python and frontend validation use the same limits.

Preset and color files are fully validated before use or replacement. Writes use
a temporary sibling filesystem location, file flush/fsync and atomic replacement;
bad or unreadable existing files are not automatically overwritten. Missing files
return defaults without creating directories. UI settings retain equivalent
atomic-write and corruption protections.

Browser library writes carry the ETag from their last successful read/save in
`If-Match`. Stale writes return 409 without modifying the file. A successful reload
is required before retrying; settings retry reloads and reapplies its pending
patch. Color changes are serialized against the latest successful state, and
style controls disable overlapping saves. Resolution drafts remain available
after failure. Full-library edits are not automatically merged across tabs;
reload/review is intentional. Callers omitting `If-Match` have unconditional
last-writer-wins semantics, but cannot overwrite an invalid existing file. Atomic
replacement does not coordinate external writers or multiple Comfy processes.

Invalid saved editor state is read-only until explicit reset. The original text
can be downloaded, closing does not write, and reset requires a second explicit
confirmation. No legacy migration or silent repair is introduced.

## Resource budgets

Image work is rejected before tensor allocation or image conversion when it
exceeds either budget below. Values are positive integer environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NERISS_MAX_IMAGE_PIXELS` | `67108864` | Maximum total pixels, including batch size |
| `NERISS_MAX_IMAGE_WORKING_BYTES` | `2147483648` | Estimated working allocation, at 48 bytes per pixel |
| `NERISS_MAX_REFERENCE_BYTES` | `33554432` | Compressed bytes per reference upload |

The estimate is a guard, not a measurement/reservation or process-wide memory cap.
Both image budgets must pass. They bound total work without imposing an arbitrary
individual side-length limit. Raising them increases allocation risk. Reference
uploads are streamed with a byte limit, decoded/encoded off the HTTP event loop,
and limited to two concurrent decode jobs. Pillow decompression-bomb failures are
handled as invalid images. Saved references are checked against the same image
budgets when loaded. Normal PNG retention behavior is unchanged.

Resize cropping never produces a zero-width/height slice. Both sizing nodes now
use decimal megapixels (`1 MP = 1,000,000 pixels`). Connected reference batches
produce an annotated preview for every frame, retaining preview batch/device/dtype;
the clean image output remains the original connected batch.

## Proxy and security tooling

Production requests use Comfy's `api.fetchApi` so its configured base path and
request headers are retained. Reference image URLs are resolved relative to the
page base. The standalone preview uses same-base fetch as its mock transport.
This fixes rooted requests without claiming a completed proxy/browser matrix.

The dependency lockfile has been refreshed without changing the pinned Playwright
version. Scheduled dependency auditing, pinned-action secret scanning, and
Dependabot configuration are included. Playwright upgrades remain paired with the
Nix browser bundle rather than automated independently. The existing release
workflow checks committed assets without building over them first.

On this checkout, Gitleaks 8.30.1 scanned all 19 reachable commits and reported no
leaks. The refreshed frontend audit reported no advisories. These results do not
guarantee the absence of secrets, malicious code or future advisories; rerun the
checks immediately before release. No credentials were rotated because none
were found.

## Verification performed for this implementation

- Python formatting, Ruff and ty checks passed using the neighboring ComfyUI
  Python environment; all 30 existing Python tests passed.
- Frontend lint, typecheck, all 47 existing unit tests, production build and
  committed-release consistency checks passed.
- The existing pinned-Chromium browser suite passed all 55 checks after fixing
  keyboard focus when Undo/Redo disables its toolbar button.
- Targeted temporary probes (not a new committed test suite) verified all four
  stores' stale-write rejection, failed replacement and corrupt-file preservation;
  actual PNG upload/retrieval; crop/batch/MP fixes; oversized-allocation rejection;
  unsupported-state/large-coordinate rejection; recovery download, no-write close,
  confirmed reset and proxy-relative reference URLs.
- Gitleaks scanned reachable history, the tracked diff and new files without
  findings. The full frontend dependency audit reported no advisories.
- Actionlint accepted the workflows. A local release-content inventory confirmed
  required assets, editable source/build scripts and license notices are retained
  while private/development/test folders are excluded. This is not a substitute
  for inspecting the eventual Comfy Registry-generated archive.

The existing unit-test HMR-port warning and the host environment's deprecated
`pynvml` warning remain non-failing observations, not new support guarantees.
No production server was started and no package was published.

## Permanent hardening regressions and conflict recovery

The regression suite now includes real aiohttp route tests for all four JSON
stores: ETag round trips, stale-write rejection and reviewed retries, corrupt and
invalid UTF-8 files, bounded requests, failed atomic replacement, and full-disk
failures. Reference-image tests exercise actual PNG upload/retrieval, path
confinement, off-event-loop processing, compressed/pixel/memory limits,
decompression-bomb errors and failed image writes. Node tests cover extreme crops,
interpolation methods, broadcast masks, batch/device/dtype preservation, decimal
megapixels and rejection before image allocation. Shared fixtures exercise Python
and TypeScript state/prompt validation against the same cases.

Browser regressions cover invalid-state downloads, no-write close and confirmed
reset in both editors. Preset conflicts preserve the draft and disable saving
until the user chooses to reload. Reload requires explicit confirmation before
replacing the draft; a failed GET retains it. Cancelling a conflicted modal
invalidates its cached library so reopening fetches the latest revision rather
than repeating stale saves. No automatic merge or unconditional overwrite is
introduced.

The reusable checks workflow runs Python 3.12 against the pinned ComfyUI commit
`8f04fd6ecf4a548937971e840af2a985529fab76` with CPU PyTorch, as well as the frontend
checks and the pinned Nix browser suite. Registry publication depends on that
workflow. No new supported-version/platform claim or real production-frontend
integration coverage is implied. Middleware-only test servers disable WebSockets
to avoid the previous shared HMR-port warning.

Local follow-up verification passed: 47 Python tests, 54 frontend unit tests and
61 pinned-Chromium checks, including mobile conflict recovery. Python formatting,
lint and type checks, frontend lint/type checks, the production build and release
asset consistency check passed. Actionlint accepted both changed workflows.
Hosted GitHub jobs have not been dispatched or claimed as verified here.
