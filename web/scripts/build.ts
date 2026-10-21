import { writeFile } from "node:fs/promises";
import process from "node:process";
import { ResultAsync, errAsync } from "neverthrow";
import { buildReleaseArtifacts } from "./release-artifacts.ts";

const result = await buildReleaseArtifacts({ write: true }).andThen((artifacts) => {
  const notices = artifacts.find((file) => file.name === "THIRD_PARTY_NOTICES.md");
  if (!notices) return errAsync("Production build did not emit third-party license notices.");
  return ResultAsync.fromPromise(
    writeFile(new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url), notices.content),
    (cause) => `Could not update root license notices: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
});
if (result.isErr()) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  console.log("Built web/dist and updated root THIRD_PARTY_NOTICES.md.");
}
