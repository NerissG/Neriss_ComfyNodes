import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Result, ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";

const versionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine((value) => value.split(".").every((part) => Number.isSafeInteger(Number(part))));
const changeSchema = z.union([z.enum(["patch", "minor", "major"]), versionSchema]);
const packageSchema = z.looseObject({ version: versionSchema });
const parseJson = Result.fromThrowable(
  (value: string): unknown => JSON.parse(value),
  () => "web/package.json is not valid JSON.",
);
const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

function field(section: string, key: "name" | "version"): Result<string, string> {
  const matches = [...section.matchAll(new RegExp(`^${key}[ \\t]*=[ \\t]*"([^"\\r\\n]*)"[ \\t]*(?:#.*)?$`, "gm"))];
  return matches.length === 1 && matches[0]?.[1] !== undefined
    ? ok(matches[0][1])
    : err(`Expected exactly one quoted ${key} in the release metadata section.`);
}

function sections(content: string): string[] {
  return content.split(/(?=^\[)/m);
}

function header(section: string): string {
  return section.split("\n", 1)[0]?.trim() ?? "";
}

function readMetadata(root: string) {
  return ResultAsync.combine(
    ["pyproject.toml", "uv.lock", "web/package.json"].map((file) =>
      ResultAsync.fromPromise(
        readFile(join(root, file), "utf8"),
        (cause) => `Could not read ${file}: ${failure(cause)}`,
      ),
    ),
  ).andThen(([projectText, lockText, packageText]) => {
    if (projectText === undefined || lockText === undefined || packageText === undefined) {
      return err("Release metadata files are missing.");
    }
    const projectSections = sections(projectText);
    const project = projectSections.filter((section) => header(section) === "[project]");
    if (project.length !== 1 || project[0] === undefined)
      return err("Expected one [project] section in pyproject.toml.");
    const projectSection = project[0];
    return Result.combine([field(projectSection, "name"), field(projectSection, "version")]).andThen(
      ([name, version]) => {
        const parsedVersion = versionSchema.safeParse(version);
        if (!parsedVersion.success) return err("project.version must be a plain X.Y.Z release.");
        const normalizedName = name.toLowerCase().replace(/[-_.]+/g, "-");
        const lockSections = sections(lockText);
        const localPackages = lockSections.filter((section) => {
          if (header(section) !== "[[package]]") return false;
          const packageName = field(section, "name");
          return packageName.isOk() && packageName.value === normalizedName;
        });
        if (localPackages.length !== 1 || localPackages[0] === undefined) {
          return err(`Expected one ${normalizedName} package in uv.lock.`);
        }
        const lockSection = localPackages[0];
        return field(lockSection, "version").andThen((lockVersion) =>
          parseJson(packageText).andThen((value) => {
            const parsedPackage = packageSchema.safeParse(value);
            if (!parsedPackage.success) return err("web/package.json needs a plain X.Y.Z version.");
            if (lockVersion !== version || parsedPackage.data.version !== version) {
              return err("Release versions differ between pyproject.toml, uv.lock and web/package.json.");
            }
            return ok({
              version,
              projectSections,
              projectSection,
              lockSections,
              lockSection,
              package: parsedPackage.data,
            });
          }),
        );
      },
    );
  });
}

export function nextReleaseVersion(current: string, change: string): Result<string, string> {
  if (!versionSchema.safeParse(current).success) return err("The current version must be a plain X.Y.Z release.");
  if (!changeSchema.safeParse(change).success) return err("Use patch, minor, major or a plain X.Y.Z release.");
  const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number);
  const next =
    change === "major"
      ? `${major + 1}.0.0`
      : change === "minor"
        ? `${major}.${minor + 1}.0`
        : change === "patch"
          ? `${major}.${minor}.${patch + 1}`
          : change;
  if (!versionSchema.safeParse(next).success) return err("The new version exceeds the supported integer range.");
  const previousParts = current.split(".").map(Number);
  const nextParts = next.split(".").map(Number);
  const changed = nextParts.findIndex((part, index) => part !== previousParts[index]);
  if (changed < 0 || (nextParts[changed] ?? 0) < (previousParts[changed] ?? 0)) {
    return err("The release version must increase.");
  }
  return ok(next);
}

export function verifyReleaseVersions(root: string) {
  return readMetadata(root).map((metadata) => metadata.version);
}

export function bumpReleaseVersion(root: string, change: string) {
  return readMetadata(root).andThen((metadata) =>
    nextReleaseVersion(metadata.version, change).asyncAndThen((version) => {
      const replaceVersion = (section: string) =>
        section.replace(/^version[ \t]*=[ \t]*"[^"\r\n]*"/m, `version = "${version}"`);
      const updates = [
        {
          file: "pyproject.toml",
          content: metadata.projectSections
            .map((section) => (section === metadata.projectSection ? replaceVersion(section) : section))
            .join(""),
        },
        {
          file: "uv.lock",
          content: metadata.lockSections
            .map((section) => (section === metadata.lockSection ? replaceVersion(section) : section))
            .join(""),
        },
        { file: "web/package.json", content: JSON.stringify({ ...metadata.package, version }, null, 2) + "\n" },
      ];
      return ResultAsync.combine(
        updates.map(({ file, content }) =>
          ResultAsync.fromPromise(
            writeFile(join(root, file), content),
            (cause) => `Could not update ${file}: ${failure(cause)}`,
          ),
        ),
      ).map(() => version);
    }),
  );
}
