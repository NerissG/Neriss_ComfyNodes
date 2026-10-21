import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ResultAsync, err, errAsync, ok } from "neverthrow";
import { build } from "vite";

const web = fileURLToPath(new URL("../", import.meta.url));
const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
export type ReleaseArtifact = { name: string; content: Buffer };

// Checks build in memory; only the explicit build command writes distribution files.
export function buildReleaseArtifacts({ write = false }: { write?: boolean } = {}): ResultAsync<
  ReleaseArtifact[],
  string
> {
  return ResultAsync.fromPromise(
    build({ root: web, configFile: join(web, "vite.config.ts"), logLevel: "warn", build: { write } }),
    failure,
  ).andThen((result) => {
    const builds = Array.isArray(result) ? result : [result];
    const artifacts = builds.flatMap((output) =>
      "output" in output
        ? output.output.map((file) => {
            const content = file.type === "chunk" ? file.code : file.source;
            return {
              name: file.fileName,
              content: typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content),
            };
          })
        : [],
    );
    if (!artifacts.some((file) => file.name === "image-editor.js" && file.content.length > 0)) {
      return err("Production build did not emit image-editor.js.");
    }
    if (!artifacts.some((file) => file.name === "THIRD_PARTY_NOTICES.md" && file.content.length > 0)) {
      return err("Production build did not emit third-party license notices.");
    }
    return ok(artifacts);
  });
}

export function verifyReleaseNotices(file: string, artifacts: ReleaseArtifact[]): ResultAsync<void, string> {
  const notices = artifacts.find((artifact) => artifact.name === "THIRD_PARTY_NOTICES.md");
  if (!notices) return errAsync("Production build did not emit third-party license notices.");
  return ResultAsync.fromPromise(readFile(file), failure)
    .mapErr((message) => `Root THIRD_PARTY_NOTICES.md is missing or unreadable: ${message}. Run pnpm run build.`)
    .andThen((content) =>
      content.equals(notices.content)
        ? ok(undefined)
        : err("Root THIRD_PARTY_NOTICES.md is stale. Run pnpm run build and include the updated notices."),
    );
}

export function verifyReleaseArtifacts(directory: string, artifacts: ReleaseArtifact[]): ResultAsync<void, string> {
  return ResultAsync.fromPromise(readdir(directory, { recursive: true, withFileTypes: true }), failure)
    .mapErr(
      (message) => `Release assets are missing or unreadable: ${message}. Run pnpm run build and include web/dist.`,
    )
    .andThen((entries) => {
      const actual = entries
        .filter((entry) => entry.isFile())
        .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .sort();
      const expected = artifacts.map((file) => file.name).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        return err(
          `Release assets do not match the build. Expected ${expected.join(", ")}; found ${actual.join(", ")}. Run pnpm run build and include all of web/dist.`,
        );
      }
      return ResultAsync.combine(
        artifacts.map((file) =>
          ResultAsync.fromPromise(readFile(join(directory, file.name)), failure).andThen((content) =>
            content.equals(file.content)
              ? ok(undefined)
              : err(`Stale release asset: ${file.name}. Run pnpm run build and include web/dist.`),
          ),
        ),
      ).map(() => undefined);
    });
}
