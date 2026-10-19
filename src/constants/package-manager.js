/**
 * Package managers a project may use and how each one runs its scripts.
 *
 * @module constants/package-manager
 */

/** Package managers golfo-rp recognizes. */
export const PACKAGE_MANAGER = Object.freeze({
  pnpm: "pnpm",
  npm: "npm",
  yarn: "yarn",
  bun: "bun",
});

/** Package manager assumed when a project declares none and has no lockfile: the historical default. */
export const DEFAULT_PACKAGE_MANAGER = PACKAGE_MANAGER.pnpm;

/** `packageManager` field of `package.json` (Corepack format, `<name>@<version>`). */
export const PACKAGE_MANAGER_FIELD = "packageManager";

/** Name part of a `packageManager` value such as `bun@1.3.11`. */
export const PACKAGE_MANAGER_FIELD_PATTERN = /^(pnpm|npm|yarn|bun)@/u;

/**
 * Lockfiles of each package manager, checked in order to reveal the package manager when
 * `packageManager` is missing. The generated CI workflow installs with a frozen lockfile, so it
 * also needs one of its package manager's lockfiles committed.
 */
export const LOCKFILE_PACKAGE_MANAGERS = Object.freeze([
  ["bun.lock", PACKAGE_MANAGER.bun],
  ["bun.lockb", PACKAGE_MANAGER.bun],
  ["pnpm-lock.yaml", PACKAGE_MANAGER.pnpm],
  ["yarn.lock", PACKAGE_MANAGER.yarn],
  ["package-lock.json", PACKAGE_MANAGER.npm],
  ["npm-shrinkwrap.json", PACKAGE_MANAGER.npm],
]);

/** Every lockfile name in {@link LOCKFILE_PACKAGE_MANAGERS}, whatever its package manager. */
export const LOCKFILE_NAMES = Object.freeze(LOCKFILE_PACKAGE_MANAGERS.map(([lockfileName]) => lockfileName));

/**
 * Prefix that runs a `package.json` script by name. `bun create-version` would run `bun create`
 * and `npm create-version` is not a command, so both need `run`; pnpm and yarn run scripts directly.
 */
export const SCRIPT_RUNNER = Object.freeze({
  [PACKAGE_MANAGER.pnpm]: "pnpm",
  [PACKAGE_MANAGER.npm]: "npm run",
  [PACKAGE_MANAGER.yarn]: "yarn",
  [PACKAGE_MANAGER.bun]: "bun run",
});

/** `package.json` script projects declare to run `golfo-rp create-version`. */
export const CREATE_VERSION_SCRIPT = "create-version";

/** How a pnpm project runs `golfo-rp create-version`: the default quoted by messages when no project is known. */
export const DEFAULT_CREATE_VERSION_COMMAND = `${SCRIPT_RUNNER[DEFAULT_PACKAGE_MANAGER]} ${CREATE_VERSION_SCRIPT}`;
