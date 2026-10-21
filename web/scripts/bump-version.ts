import process from "node:process";
import { fileURLToPath } from "node:url";
import { bumpReleaseVersion } from "./release-version.ts";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 1 || args[0] === undefined) {
  console.error("Usage: pnpm run version:bump <patch|minor|major|X.Y.Z>");
  process.exitCode = 1;
} else {
  const result = await bumpReleaseVersion(fileURLToPath(new URL("../../", import.meta.url)), args[0]);
  if (result.isErr()) {
    console.error(result.error);
    process.exitCode = 1;
  } else {
    console.log(
      `Updated pyproject.toml, uv.lock and web/package.json to ${result.value}. No commit or tag was created.`,
    );
  }
}
