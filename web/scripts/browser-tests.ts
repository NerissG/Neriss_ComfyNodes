import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { ResultAsync } from "neverthrow";

const root = fileURLToPath(new URL("../../", import.meta.url));
const web = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const inBrowserShell = Boolean(process.env.PLAYWRIGHT_VERSION && process.env.PLAYWRIGHT_BROWSERS_PATH);
const command = inBrowserShell ? process.execPath : "nix";
const require = createRequire(import.meta.url);
const playwrightArgs = args.includes("--preflight") ? ["test", "--project=preflight"] : ["test", ...args];
const commandArgs = inBrowserShell
  ? [require.resolve("@playwright/test/cli"), ...playwrightArgs]
  : ["develop", `path:${root}`, "--command", "pnpm", "run", "test:e2e", ...args];

if (!inBrowserShell) console.log("Entering the repository's pinned Nix browser environment…");
const result = await ResultAsync.fromPromise(
  new Promise<number>((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: web, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("close", () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    });
  }),
  (cause) => (cause instanceof Error ? cause.message : String(cause)),
);

if (result.isErr()) {
  console.error(
    `Browser testing could not start: ${result.error}\nUse the repository's Nix shell. Do not install browsers or search other tool caches.`,
  );
  process.exitCode = 1;
} else process.exitCode = result.value;
