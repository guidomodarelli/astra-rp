/**
 * Fake `claude` and `codex` CLIs for the changelog drafting tests: Node scripts behind a launcher
 * (`.cmd` shim on Windows, like the ones npm installs; a shell script elsewhere), so the code under
 * test resolves and runs them exactly as it would the real CLIs, which no test ever starts.
 *
 * @module tests/create-version/support/fake-agent-cli
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createTemporaryDirectory } from "./cli-harness.js";

/**
 * @typedef {{ kind: "answer", text: string } | { kind: "quota" } | { kind: "sleep" }} FakeAgentBehavior
 *   `answer` returns `text` as the agent answer, `quota` fails as an exhausted subscription does and
 *   `sleep` never answers.
 * @typedef {{ name: string, cwd: string, args: string[], prompt: string }} FakeAgentCall
 */

/** Message the fake Claude Code prints when its subscription has no quota left. */
export const FAKE_CLAUDE_QUOTA_MESSAGE = "Claude AI usage limit reached|1760000000";

/** Message the fake Codex prints when its plan has no quota left. */
export const FAKE_CODEX_QUOTA_MESSAGE = "ERROR: You've hit your usage limit.";

/**
 * Source of a fake agent: it records its call in `logPath` and then behaves as asked.
 *
 * @param {"claude" | "codex"} name - CLI to imitate.
 * @param {FakeAgentBehavior} behavior - What it answers.
 * @param {string} logPath - JSON lines file of the calls.
 * @returns {string} ES module source.
 */
function fakeAgentSource(name, behavior, logPath) {
  return `import { appendFileSync, writeFileSync } from "node:fs";
const name = ${JSON.stringify(name)};
const behavior = ${JSON.stringify(behavior)};
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ name, cwd: process.cwd(), args, prompt }) + "\\n");
  if (behavior.kind === "sleep") { setInterval(() => {}, 1000); return; }
  if (name === "claude") {
    const quota = behavior.kind === "quota";
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: quota, result: quota ? ${JSON.stringify(FAKE_CLAUDE_QUOTA_MESSAGE)} : behavior.text }));
    process.exit(quota ? 1 : 0);
  }
  if (behavior.kind === "quota") { process.stderr.write(${JSON.stringify(FAKE_CODEX_QUOTA_MESSAGE)}); process.exit(1); }
  writeFileSync(args[args.indexOf("--output-last-message") + 1], behavior.text);
});
`;
}

/**
 * Creates a directory with fake agent CLIs, to put first on `PATH`.
 *
 * @param {Partial<Record<"claude" | "codex", FakeAgentBehavior>>} agents - Agents to install and their behavior; a missing one is not installed.
 * @returns {{ binDirectory: string, readCalls: () => FakeAgentCall[] }} Directory and the calls the agents received.
 */
export function installFakeAgents(agents) {
  const binDirectory = createTemporaryDirectory("beez-rp-fake-agents-");
  const logPath = path.join(binDirectory, "calls.jsonl");

  for (const [name, behavior] of Object.entries(agents)) {
    const scriptPath = path.join(binDirectory, `${name}.mjs`);
    writeFileSync(scriptPath, fakeAgentSource(/** @type {"claude" | "codex"} */ (name), behavior, logPath));
    if (process.platform === "win32") {
      writeFileSync(path.join(binDirectory, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`);
    } else {
      const launcherPath = path.join(binDirectory, name);
      writeFileSync(launcherPath, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${name}.mjs" "$@"\n`);
      chmodSync(launcherPath, 0o755);
    }
  }

  return {
    binDirectory,
    readCalls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => /** @type {FakeAgentCall} */ (JSON.parse(line)))
        : [],
  };
}

/**
 * Name of the `PATH` variable in this process's environment (`Path` on Windows), so an override
 * replaces it instead of adding a second, ambiguous entry.
 *
 * @returns {string} Variable name.
 */
export function pathVariableName() {
  return Object.keys(process.env).find((variableName) => variableName.toUpperCase() === "PATH") ?? "PATH";
}

/**
 * `PATH` with only the fake agents, Node and the system commands the drafting needs (`where` on
 * Windows, `sh` elsewhere): the real agent CLIs installed on the machine cannot be found.
 *
 * @param {string} binDirectory - Directory of the fake agents.
 * @returns {string} Isolated `PATH`.
 */
export function isolatedAgentPath(binDirectory) {
  const systemDirectories = process.platform === "win32" ? [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/bin", "/usr/bin"];
  return [binDirectory, path.dirname(process.execPath), ...systemDirectories].join(path.delimiter);
}
