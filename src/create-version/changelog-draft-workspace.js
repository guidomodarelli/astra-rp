/**
 * Isolated workspace where the changelog drafting agents run: a temporary directory outside the
 * repository with a snapshot of the files Git tracks at `HEAD` and the release context (diff and
 * log of the release range, plus the working tree changelog) that astra-rp reads for them. The
 * agents never see the checkout, its `.git` directory nor its untracked files, and need no Git
 * command of their own.
 *
 * @module create-version/changelog-draft-workspace
 */

import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANGELOG_DRAFT_CONTEXT_DIRECTORY,
  CHANGELOG_DRAFT_CURRENT_CHANGELOG_FILE,
  CHANGELOG_DRAFT_DIFF_FILE,
  CHANGELOG_DRAFT_DIRECTORY_PREFIX,
  CHANGELOG_DRAFT_INDEX_FILE,
  CHANGELOG_DRAFT_LOG_FILE,
  CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY,
  WORKSPACE_REMOVAL_RETRIES,
} from "../constants/changelog-draft.js";
import { createGitReader, runCaptured } from "./process.js";

/**
 * @typedef {{ repositoryRoot: string, lastReleaseSha: string | null, changelogPath: string }} ChangelogDraftWorkspaceRequest
 * @typedef {{ directory: string, remove: () => void }} ChangelogDraftWorkspace
 */

/**
 * Creates the workspace: `repository/` with the tracked files at `HEAD`, and `release-context/`
 * with the diff of the release range (without the changelog the agents are drafting), its
 * `git log --stat` and the working tree changelog they will update, when it is a regular file.
 * Without a previous release, the range is the whole history.
 *
 * @param {ChangelogDraftWorkspaceRequest} request - Repository, last release and changelog path.
 * @returns {Promise<ChangelogDraftWorkspace>} Workspace directory and how to remove it.
 * @throws {Error} When Git fails or the changelog cannot be copied; the partial workspace is removed and the original error is the `cause`.
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
 * Checks out the tree of `HEAD` into the snapshot directory through a temporary index
 * (`GIT_INDEX_FILE`), so the repository index stays untouched. Unlike `git archive`, it ignores
 * the `export-ignore` and `export-subst` attributes: files such as `AGENTS.md` reach the agents as
 * they are committed.
 *
 * @param {string} repositoryRoot - Repository root.
 * @param {string} directory - Workspace directory.
 * @returns {Promise<void>} Resolves once the snapshot is checked out.
 * @throws {Error} When `git read-tree` or `git checkout-index` fail.
 */
async function extractTrackedSnapshot(repositoryRoot, directory) {
  const indexPath = path.join(directory, CHANGELOG_DRAFT_INDEX_FILE);
  const snapshotDirectory = path.join(directory, CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY);
  mkdirSync(snapshotDirectory);
  const environment = { ...process.env, GIT_INDEX_FILE: indexPath };

  for (const gitArguments of [["read-tree", "HEAD"], ["checkout-index", "--all", `--prefix=${snapshotDirectory}${path.sep}`]]) {
    const result = await runCaptured("git", gitArguments, { cwd: repositoryRoot, env: environment });
    if (result.status !== 0) {
      throw new Error(`git ${gitArguments.join(" ")} failed in ${repositoryRoot} with code ${result.status}: ${result.stderr}`);
    }
  }
  rmSync(indexPath, { force: true });
}

/**
 * Writes the diff and the log of the release range, plus the working tree changelog. The diff
 * excludes the changelog, whose empty `[Unreleased]` block is what the agents are drafting.
 *
 * @param {string} repositoryRoot - Repository root.
 * @param {string} directory - Workspace directory.
 * @param {string | null} lastReleaseSha - Commit of the last release, or `null` before the first one.
 * @param {string} changelogPath - Changelog path relative to the repository root.
 * @returns {Promise<void>} Resolves once the context files are written.
 * @throws {Error} When a Git command fails or the changelog cannot be copied.
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
  copyWorkingChangelog(repositoryRoot, contextDirectory, changelogPath);
}

/**
 * Copies the working tree changelog to the release context, so the agents infer its language and
 * conventions even when it is untracked or only changed locally. It is inspected without following
 * symlinks: a missing changelog or one that is not a regular file is left out.
 *
 * @param {string} repositoryRoot - Repository root.
 * @param {string} contextDirectory - Release context directory.
 * @param {string} changelogPath - Changelog path relative to the repository root.
 * @returns {void}
 * @throws {Error} When the changelog exists but cannot be inspected or copied.
 */
function copyWorkingChangelog(repositoryRoot, contextDirectory, changelogPath) {
  const sourcePath = path.join(repositoryRoot, changelogPath);
  if (!lstatSync(sourcePath, { throwIfNoEntry: false })?.isFile()) return;
  copyFileSync(sourcePath, path.join(contextDirectory, CHANGELOG_DRAFT_CURRENT_CHANGELOG_FILE));
}
