import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { runCapturedWithInput } from "../../src/create-version/process.js";
import { cleanupTemporaryDirectories, createTemporaryDirectory } from "./support/cli-harness.js";

/** Long enough to outlive the test unless the timeout stops it. */
const GRANDCHILD_LIFETIME_MS = 60_000;

/** Time limit after which the command is stopped, long enough for it to start its child first. */
const COMMAND_TIMEOUT_MS = 3_000;

/** Upper bound to observe the pid file or the end of the grandchild. */
const PROCESS_OBSERVATION_TIMEOUT_MS = 10_000;

/** File where the command reports the pid of the child it started. */
const GRANDCHILD_PID_FILE = "grandchild.pid";

/**
 * Script of a command that, like an agent CLI running a shell or Git command, starts a long-lived
 * child, reports its pid and keeps running. On Windows the child breaks away from the job object
 * Node assigns to its children, so it outlives a parent that is killed alone, as a Unix child would.
 */
const AGENT_SCRIPT = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: process.platform === "win32" });
writeFileSync(${JSON.stringify(GRANDCHILD_PID_FILE)}, String(grandchild.pid));
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

describe("runCapturedWithInput", () => {
  it(
    "stops every process the command started when it times out",
    async () => {
      const workingDirectory = createTemporaryDirectory("beez-rp-process-");
      const pidFile = path.join(workingDirectory, GRANDCHILD_PID_FILE);

      const result = await runCapturedWithInput(process.execPath, ["-e", AGENT_SCRIPT], {
        cwd: workingDirectory,
        input: "",
        timeoutMs: COMMAND_TIMEOUT_MS,
      });

      expect(result.timedOut).toBe(true);
      expect(result.status).toBe(1);
      expect(existsSync(pidFile)).toBe(true);
      const grandchildPid = Number(readFileSync(pidFile, "utf8"));
      await vi.waitFor(() => expect(isProcessAlive(grandchildPid)).toBe(false), { timeout: PROCESS_OBSERVATION_TIMEOUT_MS });
    },
    COMMAND_TIMEOUT_MS + PROCESS_OBSERVATION_TIMEOUT_MS * 2,
  );

  it("captures the output of a command that ends before its timeout", async () => {
    const result = await runCapturedWithInput(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      input: "prompt",
      timeoutMs: PROCESS_OBSERVATION_TIMEOUT_MS,
    });

    expect(result).toEqual({ status: 0, stdout: "prompt", stderr: "", timedOut: false, spawnErrorCode: null });
  });
});
