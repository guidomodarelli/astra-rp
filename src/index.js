/**
 * `@golfo/rp`: dependency-free release process.
 *
 * - `@golfo/rp/versions`: stable `X.Y.Z` rules; only the next patch, minor or major is allowed.
 * - `@golfo/rp/build-gate`: Vercel `ignoreCommand` decision built on those rules.
 * - `@golfo/rp/changelog`: release history generated from Git commits.
 * - `@golfo/rp/guard-publish`: `prepublishOnly` guard that blocks pnpm, yarn and bun publications.
 * - `@golfo/rp/package-manager`: detection of pnpm, bun, npm or yarn and the commands each one runs.
 * - `@golfo/rp/version-files`: rewrites the marked version lines of `versionFiles`.
 * - `@golfo/rp/terminal-ui`: boxes, spinners and prompts for release commands.
 * - `@golfo/rp/testing`: shared version bump fixtures for consumer test suites.
 * - `@golfo/rp/constants`: every constant above, grouped by domain.
 *
 * @module @golfo/rp
 */

export * from "./build-gate.js";
export * from "./changelog.js";
export * from "./guard-publish.js";
export * from "./package-manager.js";
export * from "./version-files.js";
export * from "./versions.js";
export {
  ICON,
  countTerminalRows,
  formatDuration,
  getPromptWaitMs,
  measureActiveMs,
  paint,
  print,
  renderBanner,
  renderBox,
  renderRow,
  renderStepHeader,
  resolveBoxWidth,
  resolveNumberKey,
  select,
  startSpinner,
  visibleWidth,
  wrapStyledLine,
} from "./terminal-ui.js";
export * from "./constants/index.js";
