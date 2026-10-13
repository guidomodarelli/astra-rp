/**
 * Contracts shared by local release preparation and the GitHub Actions worker.
 * @module constants/ci-release
 */

import { CREATE_VERSION_CONFIG_FILES, PACKAGE_MANIFEST_FILE, PINNED_NODE_VERSION_FILE, PROJECT_NPM_CONFIG_FILE } from "./create-version.js";
import { LOCKFILE_PACKAGE_MANAGERS } from "./package-manager.js";
import { GITHUB_REGISTRY_TOKEN_VARIABLE } from "./registry.js";

/** Release execution locations offered by the CLI. */
export const RELEASE_EXECUTION = Object.freeze({ local: "local", ci: "ci" });

/** Choices offered when the repository has no CI release configuration. */
export const CI_SETUP_CHOICE = Object.freeze({ configure: "configure", local: "local", cancel: "cancel" });

/** Default workflow filename, relative to GitHub's workflow directory. */
export const DEFAULT_CI_WORKFLOW = "release.yml";

/** Directory GitHub reads for versioned workflows. */
export const CI_WORKFLOW_DIRECTORY = ".github/workflows";

/** Named configuration export used by automatic setup without rewriting existing hooks. */
export const CI_CONFIG_EXPORT = "ci";

/** Workflow filenames accepted as a configuration value or CLI argument. */
export const CI_WORKFLOW_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.ya?ml$/u;

/** Environment variable names allowed in generated secret and variable bindings. */
export const CI_ENVIRONMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

/** Full Git commit identity passed to the worker. */
export const CI_COMMIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/u;

/** Worker inputs exposed through environment variables instead of shell interpolation. */
export const CI_RELEASE_ENVIRONMENT = Object.freeze({ version: "BEEZ_RP_RELEASE_VERSION", sha: "BEEZ_RP_RELEASE_SHA" });

/** Environment variable carrying the dispatched release tag into generated workflow steps. */
export const CI_RELEASE_TAG_ENVIRONMENT = "RELEASE_TAG";

/** Step that authenticates the dispatched tag, commit and `origin/main` ancestry before any project code runs. */
export const CI_RELEASE_IDENTITY_STEP_NAME = "Verificar identidad del release";

/** POSIX ERE equivalent of `RELEASE_VERSION_PATTERN` for the dependency-free identity step (Bash has no `\d`). */
export const CI_RELEASE_VERSION_SHELL_PATTERN = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$";

/** Environment signals that prevent a CI worker from dispatching another workflow. */
export const CI_RUNTIME_ENVIRONMENT = Object.freeze(["CI", "GITHUB_ACTIONS", "GITLAB_CI"]);

/** Normalized (trimmed, lowercase) CI signal values that explicitly mean "not a CI runtime"; any other non-empty value enables it. */
export const CI_RUNTIME_DISABLED_VALUES = Object.freeze(["", "0", "false", "no", "off"]);

/** Relative template path from the CI setup module. */
export const CI_RELEASE_TEMPLATE_FILE = "./templates/release.yml";

/** Placeholders owned by the release workflow template. */
export const CI_TEMPLATE_PLACEHOLDER = Object.freeze({ node: "__NODE_SETUP__", install: "__PACKAGE_SETUP__", environment: "__RELEASE_ENVIRONMENT__", permissions: "__RELEASE_PERMISSIONS__", command: "__RELEASE_COMMAND__", deploymentSetup: "__DEPLOYMENT_SETUP__", deployment: "__DEPLOYMENT_STEP__", deno: "__DENO_SETUP__", identity: "__RELEASE_IDENTITY_CHECK__" });

/** Version pin formats safe to place in generated package manager setup commands. */
export const CI_PACKAGE_MANAGER_VERSION_PATTERN = /^(?:pnpm|npm|yarn|bun)@([0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?)(?:\+sha\d+\.[a-fA-F0-9]+)?$/u;

/** Numeric Node.js pins (`22`, `22.14`, `v22.14.0` without its `v`) that setup-node resolves to a comparable release; aliases such as `lts/*` stay unverifiable. */
export const CI_NODE_VERSION_PIN_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?$/u;

/** Git tree modes of regular files (non-executable and executable); symlinks (`120000`) and submodules are excluded. */
export const GIT_REGULAR_FILE_MODES = Object.freeze(["100644", "100755"]);

/** Maximum external diagnostic length displayed by the CLI, in characters. */
export const CI_DIAGNOSTIC_LIMIT = 800;

/** Credentials that must be redacted from GitHub CLI diagnostics. */
export const CI_GITHUB_TOKEN_VARIABLES = Object.freeze(["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]);

/** Maximum workflow runs considered when reconciling an uncertain dispatch. */
export const CI_RUN_LOOKUP_LIMIT = 100;

/**
 * REST resources (under `repos/{owner}/{repo}/actions/`) listing organization bindings that GitHub
 * exposes to one repository, keyed by `gh` binding kind. Unlike `gh secret list --org`, they honor
 * each binding's repository visibility, so they match what `${{ secrets.* }}`/`${{ vars.* }}` resolve.
 */
export const CI_ORGANIZATION_BINDING_RESOURCE = Object.freeze({
  secret: Object.freeze({ path: "organization-secrets", collection: "secrets" }),
  variable: Object.freeze({ path: "organization-variables", collection: "variables" }),
});

/** Page size requested when listing organization bindings shared with a repository. */
export const CI_ORGANIZATION_BINDING_PAGE_SIZE = 100;

/** Git override that delegates hooks to the worker during local CI preparation. */
export const CI_GIT_HOOKS_OPTION = "core.hooksPath=/dev/null";

/** Release step that submits the already-pushed release to GitHub Actions. */
export const DISPATCH_CI_RELEASE_STEP = "dispatch-ci-release";

/** Stable failure categories of the GitHub workflow boundary. */
export const CI_FAILURE_CODE = Object.freeze({ preflight: "ci-preflight-failed", lookup: "ci-run-lookup-failed", dispatch: "ci-dispatch-unconfirmed" });

/** Default Yarn Classic pin when the project does not declare a package manager version. */
export const CI_DEFAULT_YARN_VERSION = "1.22.22";

/** pnpm setup pin for repositories detected only through their lockfile. */
export const CI_DEFAULT_PNPM_VERSION = "12.6.0";

/** Deno runtime installed when JSR publication selects its native client. */
export const CI_DENO_VERSION = "v2.9.7";

/** Native JSR client that needs a Deno runtime in the generated workflow. */
export const CI_DENO_JSR_CLIENT = "deno";

/** Observable acceptance outcomes returned by the workflow adapter. */
export const CI_DISPATCH_STATUS = Object.freeze({ submitted: "submitted", existing: "existing" });

/**
 * Prefix of the temporary directory, created inside the repository's Git directory, where `--retry-ci`
 * checks out the release tag to load the configuration stored in it; living under the checkout lets the
 * tagged configuration resolve the project's installed dependencies while staying outside the working tree.
 */
export const CI_RELEASE_TAG_CONFIG_DIRECTORY_PREFIX = "beez-rp-release-tag-config-";

/** Early-build metadata; its version and the commit that changes it scope the decision to exactly one release commit. */
export const CI_RELEASE_METADATA_FILE = ".beez-rp/release.json";

/**
 * Git trailer of the release commit naming where it was prepared (`local` or `ci`), so a resume after a
 * failed push keeps that location for every release, not only those whose Vercel metadata records it.
 */
export const RELEASE_EXECUTION_TRAILER = "Beez-Rp-Execution";

/** Vercel project configuration used to offer deployment setup for applications. */
export const CI_VERCEL_CONFIG_FILE = "vercel.json";

/** Provider handled by the generated application deployment steps. */
export const CI_VERCEL_DEPLOYMENT = "vercel";

/** Generated step that lets dependency installs (including `vercel build`) read GitHub Packages. */
export const CI_GITHUB_PACKAGES_AUTHENTICATION_STEP = "Autenticar GitHub Packages";

/** Step-scoped variable carrying the built-in Actions token into the GitHub Packages authentication step. */
export const CI_GITHUB_PACKAGES_TOKEN_VARIABLE = "GITHUB_PACKAGES_TOKEN";

/**
 * User npm config key bound to GitHub Packages. The user config (`~/.npmrc`) is read by npm, pnpm
 * (which ignores credentials in the repository `.npmrc`), Yarn 1 and Bun alike.
 */
export const CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY = "//npm.pkg.github.com/:_authToken";

/** Shell path of the runner's user npm config, where the generated step stores the GitHub Packages token. */
export const CI_RUNNER_NPM_USER_CONFIG_PATH = "$HOME/.npmrc";

/**
 * Job bindings that move the user config away from the runner's `~/.npmrc` (npm and pnpm read
 * `NPM_CONFIG_USERCONFIG`, Bun reads `$XDG_CONFIG_HOME/.npmrc`), so the token the workflow stores
 * there would never reach the install. `ci.secrets` and `ci.variables` only accept uppercase names.
 */
export const CI_NPM_USER_CONFIG_REDIRECT_VARIABLES = Object.freeze(["NPM_CONFIG_USERCONFIG", "XDG_CONFIG_HOME"]);

/**
 * Variables that locate the runner's user npm config: `HOME` (the generated step writes
 * `$HOME/.npmrc`) and {@link CI_NPM_USER_CONFIG_REDIRECT_VARIABLES}. A GitHub Packages token expanding
 * one of them would bind it to the Actions token at job level and move or break that config.
 */
export const CI_NPM_USER_CONFIG_LOCATION_VARIABLES = Object.freeze(["HOME", ...CI_NPM_USER_CONFIG_REDIRECT_VARIABLES]);

/** Only URL protocol accepted for a GitHub Packages registry, so the workflow token never travels in clear text. */
export const CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL = "https:";

/** Quote character whose wrapped `.npmrc` key or value npm's INI parser decodes as a JSON string. */
export const NPM_CONFIG_JSON_QUOTE = '"';

/** `.npmrc` key selecting a registry, default (`registry`) or scoped (`@scope:registry`). */
export const NPM_CONFIG_REGISTRY_KEY_PATTERN = /^(?:@[^\s:]+:)?registry$/u;

/** Project `.npmrc` key holding a GitHub Packages token, bound to the host or to an owner path. */
export const NPM_CONFIG_GITHUB_PACKAGES_TOKEN_KEY_PATTERN = /^\/\/npm\.pkg\.github\.com(?:\/[^:]*)?:_authToken$/u;

/**
 * Project `.npmrc` key bound to GitHub Packages, on the host or an owner path; captures the config
 * field, which is a credential when it is one of `NPM_CREDENTIAL_CONFIG_FIELDS`.
 */
export const NPM_CONFIG_GITHUB_PACKAGES_BOUND_KEY_PATTERN = /^\/\/npm\.pkg\.github\.com(?:\/[^:]*)?:([^:]+)$/u;

/**
 * Project `.npmrc` GitHub Packages key bound to an owner path (`//npm.pkg.github.com/OWNER/:field`), which
 * npm prefers over the host-level token the generated workflow writes.
 */
export const NPM_CONFIG_GITHUB_PACKAGES_OWNER_PATH_KEY_PATTERN = /^\/\/npm\.pkg\.github\.com\/[^:]+:[^:]+$/u;

/** Config field of any `.npmrc` key (`_auth`, `//host/:_authToken`, `@scope:registry`); captures the text after the last `:`. */
export const NPM_CONFIG_KEY_FIELD_PATTERN = /(?:^|:)([^:]*)$/u;

/** Value npm's INI parser gives a `.npmrc` key written without `=`. */
export const NPM_CONFIG_VALUELESS_KEY_VALUE = true;

/** `.npmrc` value that is exactly one `${NAME}` environment reference; captures the variable name. */
export const NPM_CONFIG_ENVIRONMENT_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/** Every `${NAME}` environment reference inside a `.npmrc` value, as npm expands them; captures each variable name. */
export const NPM_CONFIG_ENVIRONMENT_REFERENCES_PATTERN = /\$\{([^${}]+)\}/gu;

/** Start of an inline comment in an unquoted `.npmrc` value (INI syntax: an unescaped `;` or `#`). */
export const NPM_CONFIG_INLINE_COMMENT_PATTERN = /(?<!\\)[;#]/u;

/**
 * `.npmrc` INI section header (`[name]`). npm's INI parser nests every later key under that section,
 * so those keys never configure the top-level registries or credentials.
 */
export const NPM_CONFIG_SECTION_HEADER_PATTERN = /^\[.*\]$/u;

/** Prefixes of `.npmrc` comment lines. */
export const NPM_CONFIG_COMMENT_PREFIXES = Object.freeze(["#", ";"]);

/** Quote characters that may wrap a whole `.npmrc` key or value. */
export const NPM_CONFIG_QUOTES = Object.freeze(['"', "'"]);

/** Vercel CLI version used by generated workflows. */
export const CI_VERCEL_CLI_VERSION = "62.2.0";

/** Repository secrets required to deploy prebuilt output to Vercel. */
export const CI_VERCEL_SECRETS = Object.freeze(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);

/** Paths the generated Vercel worker writes after checkout; they must stay untracked to keep the release tree clean. */
export const CI_VERCEL_WORKER_WRITTEN_PATHS = Object.freeze([".env", ".vercel"]);

/** Environment names explicitly mentioned by a project's migration target hint. */
export const CI_MIGRATION_ENVIRONMENT_PATTERN = /\b[A-Z][A-Z0-9_]*(?:URL|TOKEN|KEY|SECRET|PASSWORD)\b/gu;

/** Bindings owned by the worker protocol and unavailable for user overrides. */
export const CI_RESERVED_ENVIRONMENT_NAMES = Object.freeze([CI_RELEASE_TAG_ENVIRONMENT, "HUSKY", ...Object.values(CI_RELEASE_ENVIRONMENT)]);

/**
 * Prefixes of the default environment variables the GitHub Actions runner sets on every step. GitHub
 * documents that they cannot be overwritten, so a job-level binding to the workflow token would not
 * reach them.
 * @see https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables
 */
export const CI_RUNNER_DEFAULT_ENVIRONMENT_PREFIXES = Object.freeze(["GITHUB_", "RUNNER_"]);

/**
 * Default runner environment variables without one of {@link CI_RUNNER_DEFAULT_ENVIRONMENT_PREFIXES}
 * (`CI` is always `true`).
 * @see https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables
 */
export const CI_RUNNER_DEFAULT_ENVIRONMENT_NAMES = Object.freeze(["CI"]);

/**
 * Prefixed names that are not runner defaults: `GITHUB_TOKEN` comes from `secrets.GITHUB_TOKEN` /
 * `github.token`, so the generated workflow can bind it.
 * @see https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables
 */
export const CI_RUNNER_BINDABLE_PREFIXED_ENVIRONMENT_NAMES = Object.freeze([GITHUB_REGISTRY_TOKEN_VARIABLE]);

/** Generated Vercel gate; it runs before dependencies are installed. */
export const CI_VERCEL_GATE_FILE = ".beez-rp/vercel-ignore-build.mjs";

/** Relative template path for the dependency-free Vercel gate. */
export const CI_VERCEL_GATE_TEMPLATE = "./templates/vercel-ignore-build.mjs";

/** Template placeholder preserving the project's original ignoreCommand. */
export const CI_VERCEL_IGNORE_PLACEHOLDER = "__ORIGINAL_IGNORE_COMMAND__";

/** Rendered workflow lines quoted when a committed generated workflow drifted from the current configuration. */
export const CI_WORKFLOW_DRIFT_PREVIEW_LINES = 3;

/**
 * Root-relative files that shape what the CI worker runs besides the configured workflow: the
 * configuration modules, the manifest, the project npm config, the Node.js pin and every lockfile.
 * Local preparation reads them from the working tree while the worker checks them out from the
 * release tag, so `--ignore-local-changes` must not set changes to them aside during CI preparation.
 */
export const CI_WORKER_CONFIGURATION_FILES = Object.freeze([
  ...CREATE_VERSION_CONFIG_FILES,
  PACKAGE_MANIFEST_FILE,
  PROJECT_NPM_CONFIG_FILE,
  PINNED_NODE_VERSION_FILE,
  ...LOCKFILE_PACKAGE_MANAGERS.map(([lockfileName]) => lockfileName),
]);

/** Prefix of the `run-name` the generated workflow gives each dispatched release, followed by its tag and commit. */
export const CI_RELEASE_RUN_TITLE_PREFIX = "beez-rp release";

/** Generated workflow step that runs `--ci-release`; its success proves checks, preparation and publication finished. */
export const CI_RELEASE_WORKER_STEP_NAME = "Checks y publicación del release";

/**
 * Environment the worker reads to query its own GitHub Actions history (set by Actions, plus the bound
 * job token); the run id and attempt identify the attempt executing the worker, excluded from that history.
 */
export const CI_ACTIONS_HISTORY_ENVIRONMENT = Object.freeze({ apiUrl: "GITHUB_API_URL", repository: "GITHUB_REPOSITORY", token: "GITHUB_TOKEN", runId: "GITHUB_RUN_ID", runAttempt: "GITHUB_RUN_ATTEMPT" });

/** GitHub REST API used when the runner does not provide `GITHUB_API_URL`. */
export const CI_DEFAULT_GITHUB_API_URL = "https://api.github.com";

/** REST API version pinned for the worker's Actions history requests. */
export const CI_GITHUB_API_VERSION = "2022-11-28";

/** Page size of the worker's Actions history requests; one release has far fewer runs, attempts or jobs. */
export const CI_ACTIONS_HISTORY_PAGE_SIZE = 100;

/** Maximum wait for each Actions history request before the worker stops without publishing, in milliseconds. */
export const CI_ACTIONS_HISTORY_TIMEOUT_MS = 30_000;

/** Step conclusion GitHub Actions reports for a step that finished successfully. */
export const CI_STEP_SUCCESS_CONCLUSION = "success";
