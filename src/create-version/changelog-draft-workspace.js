/**
 * Isolated workspace where the changelog drafting agents run: a temporary directory outside the
 * repository with a snapshot of the files Git tracks at `HEAD` and the release context (diff and
 * log of the release range) that beez-rp reads for them. The agents never see the checkout, its
 * `.git` directory nor its untracked files, and need no Git command of their own.
 *
 * @module create-version/changelog-draft-workspace
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANGELOG_DRAFT_ARCHIVE_FILE,
  CHANGELOG_DRAFT_CONTEXT_DIRECTORY,
  CHANGELOG_DRAFT_DIFF_FILE,
  CHANGELOG_DRAFT_DIRECTORY_PREFIX,
  CHANGELOG_DRAFT_LOG_FILE,
  CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY,
  TAR_EXECUTABLE,
  WORKSPACE_REMOVAL_RETRIES,
} from "../constants/changelog-draft.js";
import { createGitReader, runCaptured } from "./process.js";

/**
 * @typedef {{ repositoryRoot: string, lastReleaseSha: string | null, changelogPath: string }} ChangelogDraftWorkspaceRequest
 * @typedef {{ directory: string, remove: () => void }} ChangelogDraftWorkspace
 */

/**
 * Creates the workspace: `repository/` with the tracked files at `HEAD`, and `release-context/`
 * with the diff of the release range (without the changelog the agents are drafting) and its
 * `git log --stat`. Without a previous release, the range is the whole history.
 *
 * @param {ChangelogDraftWorkspaceRequest} request - Repository, last release and changelog path.
 * @returns {Promise<ChangelogDraftWorkspace>} Workspace directory and how to remove it.
 * @throws {Error} When Git or `tar` fail; the partial workspace is removed and the original error is the `cause`.
 */
export async function createChangelogDraftWorkspace({ repositoryRoot, lastReleaseSha, changelogPath }) {
  const directory = mkdtempSync(path.join(os.tmpdir(), CHANGELOG_DRAFT_DIRECTORY_PREFIX));
  // Retries cover Windows releasing the handles of an agent stopped for taking too long.
  const remove = () => rmSync(directory, { recursive: true, force: true, ...WORKSPACE_REMOVAL_RETRIES });

  try {
    await extractTrackedSnapshot(repositoryRoot, directory);
    await writeReleaseContext(repositoryRoot, directory, lastReleaseSha, changelogPath);
    return { directory, remove };
  } catch (error) {
    remove();
    throw new Error(`changelog-draft-workspace:create failed for ${repositoryRoot} (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
}

/**
 * Extracts `git archive HEAD` into the snapshot directory. `tar` runs inside the workspace with
 * relative paths, so GNU tar never mistakes a Windows drive (`C:`) for a remote host.
 *
 * @param {string} repositoryRoot - Repository root.
 * @param {string} directory - Workspace directory.
 * @returns {Promise<void>} Resolves once the snapshot is extracted.
 * @throws {Error} When `git archive` or `tar` fail.
 */
async function extractTrackedSnapshot(repositoryRoot, directory) {
  const archivePath = path.join(directory, CHANGELOG_DRAFT_ARCHIVE_FILE);
  await createGitReader(repositoryRoot).git(["archive", "--format=tar", `--output=${archivePath}`, "HEAD"]);
  mkdirSync(path.join(directory, CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY));

  const extraction = await runCaptured(TAR_EXECUTABLE, ["-xf", CHANGELOG_DRAFT_ARCHIVE_FILE, "-C", CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY], { cwd: directory });
  if (extraction.status !== 0) {
    throw new Error(`${TAR_EXECUTABLE} -xf ${CHANGELOG_DRAFT_ARCHIVE_FILE} failed with code ${extraction.status}: ${extraction.stderr}`);
  }
  rmSync(archivePath, { force: true });
}

/**
 * Writes the diff and the log of the release range. The diff excludes the changelog, whose empty
 * `[Unreleased]` block is what the agents are drafting.
 *
 * @param {string} repositoryRoot - Repository root.
 * @param {string} directory - Workspace directory.
 * @param {string | null} lastReleaseSha - Commit of the last release, or `null` before the first one.
 * @param {string} changelogPath - Changelog path relative to the repository root.
 * @returns {Promise<void>} Resolves once both files are written.
 * @throws {Error} When a Git command fails.
 */
async function writeReleaseContext(repositoryRoot, directory, lastReleaseSha, changelogPath) {
  const reader = createGitReader(repositoryRoot);
  // Before the first release the diff starts at the empty tree; `hash-object` reads it from an empty stdin.
  const diffBase = lastReleaseSha ?? (await reader.git(["hash-object", "-t", "tree", "--stdin"])).trim();
  const logRange = lastReleaseSha ? `${lastReleaseSha}..HEAD` : "HEAD";
  const diff = await reader.git(["diff", "--no-color", "--no-ext-diff", diffBase, "HEAD", "--", ".", `:(exclude)${changelogPath}`]);
  const log = await reader.git(["log", "--no-color", "--stat", logRange]);

  const contextDirectory = path.join(directory, CHANGELOG_DRAFT_CONTEXT_DIRECTORY);
  mkdirSync(contextDirectory);
  writeFileSync(path.join(contextDirectory, CHANGELOG_DRAFT_DIFF_FILE), `${diff}\n`);
  writeFileSync(path.join(contextDirectory, CHANGELOG_DRAFT_LOG_FILE), `${log}\n`);
}
