import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanupTemporaryDirectories, createTemporaryDirectory, spawnTrackedCommand } from "./support/cli-harness.js";

/** Long enough to outlive the test unless the cleanup terminates it. */
const GRANDCHILD_LIFETIME_MS = 60_000;

/**
 * Script of a command that, like the CLI awaiting npm or Git, starts a long-lived child inside the
 * fixture, reports its pid and keeps running. On Windows the child breaks away from the job object
 * Node assigns to its children, so it outlives a parent that is killed alone, as a Unix child would.
 */
const PARENT_SCRIPT = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, ${GRANDCHILD_LIFETIME_MS})"], { stdio: "ignore", detached: process.platform === "win32" });
writeFileSync("grandchild.pid", String(grandchild.pid));
setTimeout(() => {}, ${GRANDCHILD_LIFETIME_MS});
`;

/**
 * @param {number} processId - Process to probe.
 * @returns {boolean} Whether the process still exists.
 */
function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH") return false;
    throw error;
  }
}

afterEach(cleanupTemporaryDirectories);

describe("cli harness cleanup", () => {
  it("terminates every process a running command started before removing its fixture", async () => {
    const fixtureRoot = createTemporaryDirectory("beez-rp-harness-");
    const pidFile = path.join(fixtureRoot, "grandchild.pid");
    spawnTrackedCommand(process.execPath, ["-e", PARENT_SCRIPT], { cwd: fixtureRoot });
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
    const grandchildPid = Number(readFileSync(pidFile, "utf8"));
    expect(isProcessAlive(grandchildPid)).toBe(true);

    cleanupTemporaryDirectories();

    await vi.waitFor(() => expect(isProcessAlive(grandchildPid)).toBe(false), { timeout: 10_000 });
    expect(existsSync(fixtureRoot)).toBe(false);
  });
});
