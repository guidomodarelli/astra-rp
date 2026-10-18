#!/usr/bin/env node
/**
 * `astra-rp` command line.
 *
 * - `astra-rp ignore-build` prints why the current checkout is built or skipped
 *   and, as its last line, the decision (`BUILD` or `SKIP`), exiting with `0`.
 *   It exits with `2` when it cannot decide. Vercel wrappers must build only
 *   when the last line is `BUILD`, so any failure (including `npx` itself)
 *   skips the build.
 * - `astra-rp create-version [--bump patch|minor|major | --set-version X.Y.Z] [--dry-run]`
 *   diagnoses the repository in the current directory and ships its release
 *   from `main`, following its `astra-rp.config.js`.
 * - `astra-rp guard-publish` is the `prepublishOnly` guard: it exits with `1`
 *   and explains why when pnpm, yarn or bun publishes, and with `0` otherwise.
 *
 * @module astra-rp-cli
 */

import { decideBuildForCheckout } from "../src/build-gate.js";
import { BUILD_DECISION, DECISION_EXIT_CODE, GATE_FAILURE_EXIT_CODE } from "../src/constants/build-gate.js";
import { CLI_COMMAND } from "../src/constants/cli.js";
import { runCreateVersion } from "../src/create-version/run.js";
import { decidePublishGuardForEnvironment } from "../src/guard-publish.js";

/** Usage printed for unknown commands. */
const USAGE = `Usage: astra-rp ${CLI_COMMAND.ignoreBuild} | astra-rp ${CLI_COMMAND.createVersion} [options] | astra-rp ${CLI_COMMAND.guardPublish}`;

const [command, ...commandArguments] = process.argv.slice(2);

if (command === CLI_COMMAND.createVersion) {
  process.exitCode = await runCreateVersion({ repositoryRoot: process.cwd(), argv: commandArguments });
} else if (command === CLI_COMMAND.guardPublish) {
  const decision = decidePublishGuardForEnvironment();
  if (decision.message) {
    console.error(decision.message);
  }
  process.exitCode = decision.exitCode;
} else if (command === CLI_COMMAND.ignoreBuild) {
  try {
    const decision = decideBuildForCheckout(process.cwd());
    console.log(decision.reason);
    console.log(decision.shouldBuild ? BUILD_DECISION.build : BUILD_DECISION.skip);
    process.exitCode = DECISION_EXIT_CODE;
  } catch (error) {
    console.error("astra-rp ignore-build: could not decide; the build must be skipped.", error);
    process.exitCode = GATE_FAILURE_EXIT_CODE;
  }
} else {
  console.error(`astra-rp: unknown command "${command ?? ""}". ${USAGE}`);
  process.exitCode = GATE_FAILURE_EXIT_CODE;
}
