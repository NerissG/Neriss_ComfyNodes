import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildReleaseArtifacts, verifyReleaseArtifacts, verifyReleaseNotices } from "./release-artifacts.ts";
import { verifyReleaseVersions } from "./release-version.ts";

const result = await verifyReleaseVersions(fileURLToPath(new URL("../../", import.meta.url))).andThen(() =>
  buildReleaseArtifacts().andThen((artifacts) =>
    verifyReleaseArtifacts(fileURLToPath(new URL("../dist/", import.meta.url)), artifacts).andThen(() =>
      verifyReleaseNotices(fileURLToPath(new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url)), artifacts),
    ),
  ),
);
if (result.isErr()) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  console.log("Release versions agree; assets and third-party notices are present and match the current source.");
}
