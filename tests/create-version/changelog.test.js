/**
 * Exercises manual changelog verification with real Git repositories, and the closing of
 * `[Unreleased]` that the release commit carries.
 *
 * @module tests/create-version/changelog
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assertPreservedFilesUnchanged,
  assertUnreleasedEntries,
  closeUnreleasedSection,
  formatLocalReleaseDate,
  prepareChangelogClosing,
  readChangelogUpdateState,
  verifyChangelogUpdate,
} from "../../src/create-version/changelog.js";
import { createGitReader } from "../../src/create-version/process.js";
import { DEFAULT_PROJECT_COMMANDS } from "../../src/package-manager.js";
import { cleanupTemporaryDirectories, createTemporaryDirectory, runGit } from "./support/cli-harness.js";

afterEach(cleanupTemporaryDirectories);

/**
 * Creates a repository whose first commit contains manually maintained release notes.
 *
 * @returns {{ repositoryRoot: string, releaseRevision: string, changelogPath: string, context: import("../../src/create-version/changelog.js").ChangelogContext }} Fixture and read-only release context.
 */
function createChangelogRepository() {
  const repositoryRoot = createTemporaryDirectory("beez-rp-manual-changelog-");
  runGit(["init", "--quiet", "--initial-branch=main"], repositoryRoot);
  runGit(["config", "user.email", "release@example.test"], repositoryRoot);
  runGit(["config", "user.name", "Release Fixture"], repositoryRoot);
  runGit(["config", "commit.gpgsign", "false"], repositoryRoot);
  runGit(["config", "core.autocrlf", "false"], repositoryRoot);
  const changelogPath = path.join(repositoryRoot, "CHANGELOG.md");
  writeFileSync(changelogPath, "# Release notes\n\n## 1.0.0\n\n- Primera versión.\n");
  runGit(["add", "CHANGELOG.md"], repositoryRoot);
  runGit(["commit", "--quiet", "-m", "release: 1.0.0"], repositoryRoot);
  const releaseRevision = runGit(["rev-parse", "HEAD"], repositoryRoot);
  return { repositoryRoot, releaseRevision, changelogPath, context: { repositoryRoot, reader: createGitReader(repositoryRoot), commands: DEFAULT_PROJECT_COMMANDS } };
}

describe("manual changelog verification", () => {
  it("should reject unchanged notes when they already contain release entries", async () => {
    // Arrange
    const { context, releaseRevision, changelogPath } = createChangelogRepository();
    const before = readFileSync(changelogPath);
    const modifiedAt = statSync(changelogPath).mtimeMs;

    // Act
    const state = await readChangelogUpdateState(context.reader, context.repositoryRoot, "CHANGELOG.md", releaseRevision);

    // Assert
    expect(state.updated).toBe(false);
    await expect(verifyChangelogUpdate(context, "CHANGELOG.md", releaseRevision)).rejects.toThrow("no fue actualizado desde el último release");
    expect(readFileSync(changelogPath)).toEqual(before);
    expect(statSync(changelogPath).mtimeMs).toBe(modifiedAt);
    expect(runGit(["status", "--porcelain"], context.repositoryRoot)).toBe("");
  });

  it.each(["unstaged", "staged", "committed"])("should preserve manual notes when the update is %s", async (updateState) => {
    // Arrange
    const { context, releaseRevision, changelogPath } = createChangelogRepository();
    writeFileSync(changelogPath, "# Notas propias\r\n\r\n## Próximo lanzamiento\r\n\r\n- Mejora escrita a mano.\r\n");
    if (updateState !== "unstaged") runGit(["add", "CHANGELOG.md"], context.repositoryRoot);
    if (updateState === "committed") runGit(["commit", "--quiet", "-m", "docs: update release notes"], context.repositoryRoot);
    const before = readFileSync(changelogPath);
    const modifiedAt = statSync(changelogPath).mtimeMs;
    const status = runGit(["status", "--porcelain"], context.repositoryRoot);

    // Act
    const preserved = await verifyChangelogUpdate(context, "CHANGELOG.md", releaseRevision);
    assertPreservedFilesUnchanged(context, [preserved]);

    // Assert
    expect(preserved.originalBytes).toEqual(before);
    expect(readFileSync(changelogPath)).toEqual(before);
    expect(statSync(changelogPath).mtimeMs).toBe(modifiedAt);
    expect(runGit(["status", "--porcelain"], context.repositoryRoot)).toBe(status);
  });

  it.each(["missing", "directory"])("should stop without creating notes when the changelog is a %s", async (fileState) => {
    // Arrange
    const { context, releaseRevision, changelogPath } = createChangelogRepository();
    rmSync(changelogPath);
    if (fileState === "directory") mkdirSync(changelogPath);

    // Act and Assert
    await expect(verifyChangelogUpdate(context, "CHANGELOG.md", releaseRevision)).rejects.toThrow("no existe como archivo regular");
    expect(runGit(["status", "--porcelain"], context.repositoryRoot)).toBe("D CHANGELOG.md");
  });

  it("should accept existing manual notes when there is no previous release", async () => {
    // Arrange
    const { context, changelogPath } = createChangelogRepository();
    const before = readFileSync(changelogPath);

    // Act
    const preserved = await verifyChangelogUpdate(context, "CHANGELOG.md", null);

    // Assert
    expect(preserved.originalBytes).toEqual(before);
    expect(runGit(["status", "--porcelain"], context.repositoryRoot)).toBe("");
  });

  it("should report a later change without restoring the manually maintained notes", async () => {
    // Arrange
    const { context, changelogPath } = createChangelogRepository();
    const preserved = await verifyChangelogUpdate(context, "CHANGELOG.md", null);
    writeFileSync(changelogPath, "# Notas modificadas por un check\n");
    const changed = readFileSync(changelogPath);

    // Act and Assert
    expect(() => assertPreservedFilesUnchanged(context, [preserved])).toThrow("Un paso anterior modificó CHANGELOG.md");
    expect(readFileSync(changelogPath)).toEqual(changed);
  });
});

describe("closing [Unreleased] in the release commit", () => {
  it("should rename [Unreleased] to the released version and date, keeping its body and the published history", () => {
    // Arrange
    const changelog = "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n\n- Algo nuevo.\n\n## [1.0.0] - 2026-01-01\n\n- Primera versión.\n";

    // Act
    const closed = closeUnreleasedSection(changelog, "1.1.0", "2026-10-13");

    // Assert
    expect(closed).toBe("# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [1.1.0] - 2026-10-13\n\n### Added\n\n- Algo nuevo.\n\n## [1.0.0] - 2026-01-01\n\n- Primera versión.\n");
  });

  it("should keep CRLF line breaks and sections outside Keep a Changelog", () => {
    expect(closeUnreleasedSection("# Notas\r\n\r\n## [unreleased]\r\n\r\n### Mejoras\r\n\r\n- Algo.\r\n", "2.0.0", "2026-02-03")).toBe(
      "# Notas\r\n\r\n## [Unreleased]\r\n\r\n## [2.0.0] - 2026-02-03\r\n\r\n### Mejoras\r\n\r\n- Algo.\r\n"
    );
  });

  it.each([
    ["without an [Unreleased] heading", "# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- Primera versión.\n", "no tiene una sección ## [Unreleased]"],
    ["with an [Unreleased] block without entries", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [1.0.0] - 2026-01-01\n\n- Primera versión.\n", "no tiene entradas"],
  ])("should refuse to close a changelog %s", (_description, changelog, message) => {
    expect(() => closeUnreleasedSection(changelog, "1.1.0", "2026-10-13")).toThrow(message);
  });

  it("should date the release with the local day, padded to YYYY-MM-DD", () => {
    expect(formatLocalReleaseDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(formatLocalReleaseDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("should prepare the closed changelog with its original bytes for the rollback", async () => {
    // Arrange
    const { context, changelogPath } = createChangelogRepository();
    writeFileSync(changelogPath, "# Release notes\n\n## [Unreleased]\n\n- Mejora.\n\n## 1.0.0\n\n- Primera versión.\n");
    const before = readFileSync(changelogPath);
    const verified = await verifyChangelogUpdate(context, "CHANGELOG.md", null);

    // Act
    const update = prepareChangelogClosing(context, verified, "1.1.0", "2026-10-13");

    // Assert
    expect(update).toEqual({
      filePath: "CHANGELOG.md",
      originalBytes: before,
      content: "# Release notes\n\n## [Unreleased]\n\n## [1.1.0] - 2026-10-13\n\n- Mejora.\n\n## 1.0.0\n\n- Primera versión.\n",
    });
    expect(readFileSync(changelogPath)).toEqual(before);
  });

  it("should stop with an actionable hint when [Unreleased] has no entries or a check changed the changelog", async () => {
    // Arrange
    const { context, changelogPath } = createChangelogRepository();
    const verified = await verifyChangelogUpdate(context, "CHANGELOG.md", null);

    // Act and Assert
    expect(() => assertUnreleasedEntries(context, verified)).toThrow(expect.objectContaining({ hint: expect.stringContaining("bajo ## [Unreleased] en CHANGELOG.md, sin versión ni fecha") }));
    writeFileSync(changelogPath, "# Notas modificadas por un check\n\n## [Unreleased]\n\n- Algo.\n");
    expect(() => prepareChangelogClosing(context, verified, "1.1.0", "2026-10-13")).toThrow("Un paso anterior modificó CHANGELOG.md");
  });

  it("should stop before the bump, without rewriting it, when the changelog is not valid UTF-8", async () => {
    // Arrange
    const { context, changelogPath } = createChangelogRepository();
    const latin1Changelog = Buffer.from("# Notas\n\n## [Unreleased]\n\n- Corrección de la canción.\n", "latin1");
    writeFileSync(changelogPath, latin1Changelog);
    const verified = await verifyChangelogUpdate(context, "CHANGELOG.md", null);

    // Act and Assert
    const expectedFailure = expect.objectContaining({
      message: expect.stringContaining("CHANGELOG.md no es texto UTF-8 válido"),
      hint: expect.stringContaining("Convertilo a UTF-8"),
    });
    expect(() => assertUnreleasedEntries(context, verified)).toThrow(expectedFailure);
    expect(() => prepareChangelogClosing(context, verified, "1.1.0", "2026-10-13")).toThrow(expectedFailure);
    expect(readFileSync(changelogPath)).toEqual(latin1Changelog);
  });
});
