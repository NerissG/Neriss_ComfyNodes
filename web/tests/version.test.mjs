import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { test } from "node:test";
import { bumpReleaseVersion, nextReleaseVersion, verifyReleaseVersions } from "../scripts/release-version.ts";

const project = '[project]\nname = "Neriss_ComfyNodes"\nversion = "0.1.0"\n\n[tool.example]\nversion = "9.9.9"\n';
const lock =
  'version = 1\n\n[[package]]\nname = "neriss-comfynodes"\nversion = "0.1.0"\nsource = { virtual = "." }\n\n[[package]]\nname = "ruff"\nversion = "0.17.1"\n';
const frontend =
  JSON.stringify(
    { name: "Neriss_ComfyNodes", private: true, version: "0.1.0", scripts: { test: "node --test" } },
    null,
    2,
  ) + "\n";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "release-version-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "web"));
  await writeFile(join(root, "pyproject.toml"), project);
  await writeFile(join(root, "uv.lock"), lock);
  await writeFile(join(root, "web/package.json"), frontend);
  return root;
}

async function snapshot(root) {
  return Promise.all(
    ["pyproject.toml", "uv.lock", "web/package.json"].map((file) => readFile(join(root, file), "utf8")),
  );
}

test("release increments and explicit versions follow plain X.Y.Z ordering", () => {
  for (const [current, change, expected] of [
    ["0.1.0", "patch", "0.1.1"],
    ["0.1.9", "minor", "0.2.0"],
    ["0.9.9", "major", "1.0.0"],
    ["1.9.0", "1.10.0", "1.10.0"],
  ]) {
    const result = nextReleaseVersion(current, change);
    assert.equal(result.isOk(), true);
    assert.equal(result.value, expected);
  }
  for (const change of [
    "0.1.0",
    "0.0.9",
    "01.2.3",
    "1.2",
    "1.2.3-beta.1",
    "v1.2.3",
    "invalid",
    "9007199254740992.0.0",
  ]) {
    assert.equal(nextReleaseVersion("0.1.0", change).isErr(), true, change);
  }
  assert.equal(nextReleaseVersion("invalid", "patch").isErr(), true);
  assert.equal(nextReleaseVersion("9007199254740991.0.0", "major").isErr(), true);
});

test("one bump updates all release versions without changing unrelated metadata", async (context) => {
  const root = await fixture(context);
  const result = await bumpReleaseVersion(root, "minor");
  assert.equal(result.isOk(), true, result.error);
  assert.equal(result.value, "0.2.0");
  assert.equal((await verifyReleaseVersions(root)).value, "0.2.0");
  const [updatedProject, updatedLock, updatedFrontend] = await snapshot(root);
  assert.equal(updatedProject, project.replace('version = "0.1.0"', 'version = "0.2.0"'));
  assert.equal(updatedLock, lock.replace('version = "0.1.0"', 'version = "0.2.0"'));
  assert.deepEqual(JSON.parse(updatedFrontend), { ...JSON.parse(frontend), version: "0.2.0" });
  const explicit = await bumpReleaseVersion(root, "1.0.0");
  assert.equal(explicit.value, "1.0.0");
});

test("invalid and non-increasing bumps do not write any files", async (context) => {
  const root = await fixture(context);
  const before = await snapshot(root);
  for (const change of ["invalid", "0.1.0", "0.0.1", "1.0.0-rc.1"]) {
    assert.equal((await bumpReleaseVersion(root, change)).isErr(), true);
    assert.deepEqual(await snapshot(root), before);
  }
});

test("release checks reject version drift and bumps refuse to hide it", async (context) => {
  for (const file of ["uv.lock", "web/package.json"]) {
    const root = await fixture(context);
    const content = await readFile(join(root, file), "utf8");
    await writeFile(join(root, file), content.replace("0.1.0", "0.0.1"));
    const before = await snapshot(root);
    const checked = await verifyReleaseVersions(root);
    assert.equal(checked.isErr(), true);
    assert.match(checked.error, /versions differ/);
    assert.equal((await bumpReleaseVersion(root, "patch")).isErr(), true);
    assert.deepEqual(await snapshot(root), before);
  }
});

test("malformed or missing metadata fails before writing", async (context) => {
  for (const [file, content] of [
    ["pyproject.toml", project.replace("[project]", "[tool.other]")],
    ["pyproject.toml", project.replace('version = "0.1.0"', 'version = "0.1.0"\nversion = "0.1.0"')],
    ["uv.lock", lock.replace("neriss-comfynodes", "another-package")],
    ["web/package.json", "{broken"],
  ]) {
    const root = await fixture(context);
    await writeFile(join(root, file), content);
    const before = await snapshot(root);
    assert.equal((await bumpReleaseVersion(root, "patch")).isErr(), true);
    assert.deepEqual(await snapshot(root), before);
  }
  const root = await fixture(context);
  await rm(join(root, "uv.lock"));
  assert.equal((await bumpReleaseVersion(root, "patch")).isErr(), true);
  assert.equal(await readFile(join(root, "pyproject.toml"), "utf8"), project);
});

test("repository release versions agree and CI tools match the declared development minimums", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const versions = await verifyReleaseVersions(root);
  assert.equal(versions.isOk(), true, versions.error);
  const metadata = await readFile(join(root, "pyproject.toml"), "utf8");
  const workflow = await readFile(join(root, ".github/workflows/check-release.yml"), "utf8");
  for (const tool of ["ruff", "ty"]) {
    const minimum = metadata.match(new RegExp(`"${tool}>=([0-9.]+)"`))?.[1];
    assert.ok(minimum, `Missing ${tool} development requirement`);
    assert.ok(workflow.includes(`${tool}==${minimum}`), `CI must use the declared ${tool} minimum`);
  }
});
