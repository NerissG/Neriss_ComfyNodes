import { createRequire } from "node:module";
import process from "node:process";
import { chromium, type FullConfig } from "@playwright/test";
import { ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";
import { mockUiSettings } from "./settings-mock";

const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export default async function setup(config: FullConfig): Promise<void> {
  const require = createRequire(import.meta.url);
  const metadata: unknown = require("@playwright/test/package.json");
  const version = z.object({ version: z.string() }).safeParse(metadata);
  const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (
    !version.success ||
    version.data.version !== process.env.PLAYWRIGHT_VERSION ||
    !browserPath?.startsWith("/nix/store/")
  ) {
    console.error(
      "Browser preflight failed: Playwright and the Nix browser bundle must have matching versions. Run pnpm run test:e2e through the pinned project environment. Do not download a replacement browser.",
    );
    process.exit(1);
  }
  const baseURL = z.url().safeParse(config.projects[0]?.use.baseURL);
  if (!baseURL.success) {
    console.error("Browser preflight failed: the preview URL is missing from playwright.config.ts.");
    process.exit(1);
  }
  const launched = await ResultAsync.fromPromise(chromium.launch(), failure);
  if (launched.isErr()) {
    console.error(
      `Browser preflight failed to launch the Nix browser:\n${launched.error}\nCheck the declared shell and runner permissions; do not search other caches.`,
    );
    process.exit(1);
  }
  const browser = launched.value;
  const runtimeErrors: string[] = [];
  const checked = await ResultAsync.fromPromise(browser.newPage(), failure)
    .andThen((page) => {
      page.on("pageerror", (error) => runtimeErrors.push(error.stack || error.message));
      return ResultAsync.fromPromise(mockUiSettings(page), failure)
        .andThen(() =>
          ResultAsync.fromPromise(
            page.route("**/neriss_comfynodes/resolution/presets", (route) =>
              route.fulfill({ json: { presets: [{ name: "Square", x: 1, y: 1 }] } }),
            ),
            failure,
          ),
        )
        .andThen(() => ResultAsync.fromPromise(page.goto(`${baseURL.data}/preview/index.html`), failure))
        .andThen((response) =>
          response?.ok() ? ok(page) : err("The preview server did not return a successful response."),
        );
    })
    .andThen((page) =>
      ResultAsync.fromPromise(
        page.getByRole("dialog", { name: "MOSS Layout Prompt Editor" }).waitFor({ timeout: 15_000 }),
        failure,
      ),
    );
  const closed = await ResultAsync.fromPromise(browser.close(), failure);
  if (checked.isErr() || closed.isErr()) {
    console.error(
      `Browser preflight failed: ${checked.isErr() ? checked.error : closed.isErr() ? closed.error : "unknown error"}`,
    );
    if (runtimeErrors.length) console.error(runtimeErrors.join("\n"));
    process.exit(1);
  }
  console.log(
    `Browser preflight passed: Playwright ${version.data.version}, Nix Chromium, and the editor preview are ready.`,
  );
}
