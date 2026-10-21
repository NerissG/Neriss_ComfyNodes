import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { before, test } from "node:test";
import { buildReleaseArtifacts, verifyReleaseArtifacts, verifyReleaseNotices } from "../scripts/release-artifacts.ts";

const require = createRequire(import.meta.url);
let artifacts;
before(async () => {
  const built = await buildReleaseArtifacts();
  assert.equal(built.isOk(), true, built.isErr() ? built.error : "");
  artifacts = built.value;
});

async function releaseDirectory(context) {
  const directory = await mkdtemp(join(tmpdir(), "release-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of artifacts) await writeFile(join(directory, file.name), file.content);
  return directory;
}

test("production output includes complete notices for every bundled runtime dependency", async () => {
  const notices = artifacts.find((file) => file.name === "THIRD_PARTY_NOTICES.md")?.content.toString("utf8");
  assert.equal(typeof notices, "string");
  for (const [name, licenseFile] of [
    ["svelte", "LICENSE.md"],
    ["zod", "LICENSE"],
    ["neverthrow", "LICENSE"],
  ]) {
    const metadataPath = require.resolve(`${name}/package.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const license = await readFile(join(dirname(metadataPath), licenseFile), "utf8");
    assert.ok(notices.includes(`## ${name} - ${metadata.version} (MIT)`));
    assert.ok(notices.includes(license.trim()), `Missing full ${name} copyright/permission notice`);
  }
  assert.equal((notices.match(/^## /gm) ?? []).length, 3);
});

test("release check accepts the complete current production output", async (context) => {
  const directory = await releaseDirectory(context);
  assert.equal((await verifyReleaseArtifacts(directory, artifacts)).isOk(), true);
});

test("release check rejects missing output without creating it", async (context) => {
  const parent = await releaseDirectory(context);
  const directory = join(parent, "missing");
  const checked = await verifyReleaseArtifacts(directory, artifacts);
  assert.equal(checked.isErr(), true);
  assert.match(checked.error, /missing or unreadable/);
  await mkdir(directory);
});

test("release check rejects missing notices even when the JS exists", async (context) => {
  const directory = await releaseDirectory(context);
  await rm(join(directory, "THIRD_PARTY_NOTICES.md"));
  const checked = await verifyReleaseArtifacts(directory, artifacts);
  assert.equal(checked.isErr(), true);
  assert.match(checked.error, /THIRD_PARTY_NOTICES/);
});

test("release check rejects stale JS and notices without repairing them", async (context) => {
  for (const name of ["image-editor.js", "THIRD_PARTY_NOTICES.md"]) {
    const directory = await releaseDirectory(context);
    await writeFile(join(directory, name), "stale");
    const checked = await verifyReleaseArtifacts(directory, artifacts);
    assert.equal(checked.isErr(), true);
    assert.match(checked.error, /Stale release asset/);
    assert.equal(await readFile(join(directory, name), "utf8"), "stale");
  }
});

test("release check rejects leftover files from older builds", async (context) => {
  const directory = await releaseDirectory(context);
  await writeFile(join(directory, "old-editor.js"), "old build");
  assert.equal((await verifyReleaseArtifacts(directory, artifacts)).isErr(), true);
});

test("root notices match the generated dependency licenses", async (context) => {
  const directory = await releaseDirectory(context);
  const file = join(directory, "THIRD_PARTY_NOTICES.md");
  assert.equal((await verifyReleaseNotices(file, artifacts)).isOk(), true);
});

test("release check rejects missing or stale root notices without replacing them", async (context) => {
  const directory = await releaseDirectory(context);
  const file = join(directory, "ROOT_NOTICES.md");
  const missing = await verifyReleaseNotices(file, artifacts);
  assert.equal(missing.isErr(), true);
  assert.match(missing.error, /Root THIRD_PARTY_NOTICES.md is missing/);
  await writeFile(file, "stale");
  const stale = await verifyReleaseNotices(file, artifacts);
  assert.equal(stale.isErr(), true);
  assert.match(stale.error, /Root THIRD_PARTY_NOTICES.md is stale/);
  assert.equal(await readFile(file, "utf8"), "stale");
});

test("root notices survive removal of the distribution directory", async (context) => {
  const directory = await releaseDirectory(context);
  const file = join(directory, "THIRD_PARTY_NOTICES.md");
  const dist = join(directory, "web", "dist");
  await mkdir(dist, { recursive: true });
  for (const artifact of artifacts) await writeFile(join(dist, artifact.name), artifact.content);
  await rm(dist, { recursive: true });
  assert.equal((await verifyReleaseNotices(file, artifacts)).isOk(), true);
});
