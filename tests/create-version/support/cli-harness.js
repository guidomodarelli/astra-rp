/**
 * Harness of the end-to-end `create-version` tests: an isolated environment
 * (no inherited npm token or registry, a temporary home, no colors), Git
 * helpers and the real CLI run as a child process.
 *
 * @module tests/create-version/support/cli-harness
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CI_RELEASE_ENVIRONMENT, CI_RELEASE_TAG_ENVIRONMENT } from "../../../src/constants/ci-release.js";

/** Real Git fixtures with a bare remote can exceed the default timeout on Windows. */
export const GIT_FIXTURE_TEST_TIMEOUT_MS = 60_000;

/** Token the fixture registry accepts for the package owner; not a real credential. */
export const OWNER_TOKEN = "fixture-owner-token";

/** npm user of {@link OWNER_TOKEN}. */
export const OWNER_USER = "fixture-owner";

/** Git variables exported by hooks that would redirect fixture commands. */
const GIT_HOOK_ENVIRONMENT_VARIABLES = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"];

/**
 * Variables of the test runner that would change the token or the registry the command resolves:
 * the command under test only sees the ones each test sets.
 */
const ISOLATED_NPM_VARIABLE_PATTERN = /^(?:npm_config_(?:@[^:]+:)?registry|npm_token)$/iu;

/**
 * Release identity the generated workflow exports while it runs `pnpm check` inside a real CI
 * release: inherited by a fixture worker, it would describe the real release instead of the
 * fixture's, so the command under test only sees the values each test sets.
 */
const ISOLATED_CI_RELEASE_VARIABLES = new Set([...Object.values(CI_RELEASE_ENVIRONMENT), CI_RELEASE_TAG_ENVIRONMENT]);

/** Box borders removed by {@link flattenOutput}. */
const BOX_BORDER_PATTERN = /[│╭╮╰╯─]/gu;

/** Command line entrypoint exercised end to end. */
const CLI_PATH = fileURLToPath(new URL("../../../bin/beez-rp.js", import.meta.url));

/** Directories created by the current test, removed by {@link cleanupTemporaryDirectories}. */
export const temporaryDirectories = /** @type {string[]} */ ([]);

/** Commands started by {@link spawnTrackedCommand} that have not closed yet, such as one a timed-out test left behind. */
const runningCommands = new Set(/** @type {import("node:child_process").ChildProcess[]} */ ([]));

/** Unix runs each tracked command as the leader of its own process group, so the whole group can be signaled. */
const IS_WINDOWS = process.platform === "win32";

/**
 * Removal retries while Windows releases files a stopped command still held open (EPERM, EBUSY).
 * `rmSync` waits `retryDelay` times the attempt number between tries.
 */
const TEMPORARY_DIRECTORY_REMOVAL = { maxRetries: 10, retryDelay: 100 };

/**
 * @param {string} prefix - Directory name prefix.
 * @returns {string} New temporary directory, removed after the test.
 */
export function createTemporaryDirectory(prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Terminates a command together with every process it started, such as the npm or Git commands the CLI awaits.
 * `taskkill /T` returns once the whole tree has ended; on Unix the command leads its own process group.
 *
 * @param {import("node:child_process").ChildProcess} command - Command started by {@link spawnTrackedCommand}.
 */
function terminateCommandTree(command) {
  if (command.pid === undefined) return;
  if (IS_WINDOWS) {
    // A tree that already ended makes taskkill fail, which leaves nothing to clean.
    spawnSync("taskkill", ["/pid", String(command.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-command.pid, "SIGKILL");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") throw error;
  }
}

/**
 * Stops commands still running, with every process they started, and removes every directory
 * {@link createTemporaryDirectory} created. A test that times out leaves its command running inside those
 * directories: Windows refuses to delete them and orphaned processes would interfere with later tests.
 */
export function cleanupTemporaryDirectories() {
  for (const command of runningCommands) {
    terminateCommandTree(command);
  }
  runningCommands.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, ...TEMPORARY_DIRECTORY_REMOVAL });
  }
}

/** @returns {NodeJS.ProcessEnv} Environment without Git hook redirections. */
export function cleanEnvironment() {
  const environment = { ...process.env };
  for (const variableName of GIT_HOOK_ENVIRONMENT_VARIABLES) delete environment[variableName];
  return environment;
}

/**
 * Environment of the command under test: no inherited npm token, registry nor CI release identity, and a temporary home
 * (`HOME`/`USERPROFILE`) so the user's real `~/.config/beez-rp/.env` never leaks in.
 *
 * @param {NodeJS.ProcessEnv} [overrides] - Variables the test sets, such as `NPM_TOKEN`.
 * @returns {NodeJS.ProcessEnv} Environment.
 */
export function commandEnvironment(overrides = {}) {
  const temporaryHome = createTemporaryDirectory("beez-rp-cli-home-");
  const environment = Object.fromEntries(Object.entries(cleanEnvironment()).filter(([variableName]) => !ISOLATED_NPM_VARIABLE_PATTERN.test(variableName) && !ISOLATED_CI_RELEASE_VARIABLES.has(variableName)));
  // FORCE_COLOR wins over NO_COLOR, and the ANSI codes it adds split the messages the tests match.
  delete environment.FORCE_COLOR;
  return { ...environment, HOME: temporaryHome, USERPROFILE: temporaryHome, NO_COLOR: "1", ...overrides };
}

/**
 * Joins the output without box borders nor line wrapping, so long messages can be matched whole.
 *
 * @param {string} output - Command output.
 * @returns {string} Output on a single line with single spaces.
 */
export function flattenOutput(output) {
  return output.replace(BOX_BORDER_PATTERN, " ").replace(/\s+/gu, " ");
}

/**
 * @param {string[]} gitArguments - Git arguments.
 * @param {string} workingDirectory - Repository.
 * @returns {string} Trimmed stdout.
 */
export function runGit(gitArguments, workingDirectory) {
  const result = spawnSync("git", gitArguments, { cwd: workingDirectory, encoding: "utf8", env: cleanEnvironment() });

  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(" ")} failed: ${result.stderr}`);
  }

  return result.stdout.trim();
}

/**
 * Path from Git for Windows' `git --exec-path` (`<install>/mingw64/libexec/git-core`) to its Bash.
 * `bash` on the Windows `PATH` usually resolves to WSL, which drops the backslashes of Windows
 * paths and does not inherit the spawned environment.
 */
const GIT_FOR_WINDOWS_BASH_FROM_EXEC_PATH = ["..", "..", "..", "bin", "bash.exe"];

/**
 * Bash that runs scripts against the same Git the fixtures use: Git for Windows' Bash on Windows,
 * `bash` from `PATH` elsewhere.
 *
 * @returns {string} Bash executable.
 */
export function resolveBashExecutable() {
  if (process.platform !== "win32") return "bash";
  return path.resolve(runGit(["--exec-path"], process.cwd()), ...GIT_FOR_WINDOWS_BASH_FROM_EXEC_PATH);
}

/**
 * Turns a fixture directory into a Git repository (when it is not one yet) and commits every file,
 * so code that reads HEAD, as the CI worker sees the release commit, finds the fixture content.
 *
 * @param {string} repositoryRoot - Fixture directory.
 * @returns {string} Commit SHA at HEAD.
 */
export function commitFixtureRepository(repositoryRoot) {
  runGit(["init", "--quiet", "--initial-branch=main"], repositoryRoot);
  for (const [name, value] of [["user.name", "Release Fixture"], ["user.email", "release@example.test"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) runGit(["config", name, value], repositoryRoot);
  runGit(["add", "-A"], repositoryRoot);
  runGit(["commit", "--quiet", "--allow-empty", "-m", "fixture"], repositoryRoot);
  return runGit(["rev-parse", "HEAD"], repositoryRoot);
}

/**
 * @param {string} repositoryRoot - Checkout used as working directory.
 * @param {string[]} commandArguments - Arguments after `create-version`.
 * @returns {{ status: number | null, output: string }} Exit code and combined output.
 */
export function runCli(repositoryRoot, commandArguments) {
  const result = spawnSync(process.execPath, [CLI_PATH, "create-version", ...commandArguments], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: commandEnvironment(),
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Runs the command without blocking the event loop, so a fixture registry in this process can answer npm.
 *
 * @param {string} repositoryRoot - Checkout used as working directory.
 * @param {string[]} commandArguments - Arguments after `create-version`.
 * @param {NodeJS.ProcessEnv} [environmentOverrides] - Variables such as `NPM_TOKEN`.
 * @returns {Promise<{ status: number | null, output: string }>} Exit code and combined output.
 */
export function runCliAsync(repositoryRoot, commandArguments, environmentOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawnTrackedCommand(process.execPath, [CLI_PATH, "create-version", ...commandArguments], { cwd: repositoryRoot, env: commandEnvironment(environmentOverrides) });
    let output = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
  });
}

/**
 * Starts a command that {@link cleanupTemporaryDirectories} stops if it is still running when the test ends.
 *
 * @param {string} command - Executable.
 * @param {string[]} commandArguments - Arguments.
 * @param {import("node:child_process").SpawnOptions} options - Working directory and environment.
 * @returns {import("node:child_process").ChildProcess} The started command.
 */
export function spawnTrackedCommand(command, commandArguments, options) {
  const child = spawn(command, commandArguments, { ...options, detached: !IS_WINDOWS });
  runningCommands.add(child);
  child.on("close", () => runningCommands.delete(child));
  return child;
}

/** Locale whose short date is `YYYY-MM-DD`, to compute release dates independently of beez-rp. */
const ISO_DAY_LOCALE = "sv-SE";

/**
 * Lists the local days a release created by `run` may carry in its closed changelog: the day before
 * and the day after it ran (they differ only when the run crosses midnight).
 *
 * @template T
 * @param {() => T | Promise<T>} run - Runs the release.
 * @returns {Promise<{ result: T, releaseDays: string[] }>} What `run` returned and the possible `YYYY-MM-DD` days.
 */
export async function runWithReleaseDays(run) {
  const dayBefore = new Date().toLocaleDateString(ISO_DAY_LOCALE);
  const result = await run();
  return { result, releaseDays: [...new Set([dayBefore, new Date().toLocaleDateString(ISO_DAY_LOCALE)])] };
}

/**
 * Builds the changelog a release commit should carry: `[Unreleased]` renamed to the version and an
 * empty `[Unreleased]` on top.
 *
 * @param {string} title - Text before `## [Unreleased]`, such as `"# Changelog\n\n"`.
 * @param {string} version - Released version.
 * @param {string} releaseDay - Release day in `YYYY-MM-DD` format.
 * @param {string} body - Text after the `[Unreleased]` heading.
 * @returns {string} Closed changelog.
 */
export function closedChangelog(title, version, releaseDay, body) {
  return `${title}## [Unreleased]\n\n## [${version}] - ${releaseDay}${body}`;
}
