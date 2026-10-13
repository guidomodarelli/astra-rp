/**
 * Contracts shared by local release preparation and the GitHub Actions worker.
 * @module constants/ci-release
 */

import { CREATE_VERSION_CONFIG_FILES, PACKAGE_MANIFEST_FILE, PINNED_NODE_VERSION_FILE, PROJECT_NPM_CONFIG_FILE } from "./create-version.js";
import { LOCKFILE_NAMES } from "./package-manager.js";

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
 * Variables that locate the runner's user npm config outside the package managers' own settings: `HOME`
 * (the generated step writes `$HOME/.npmrc`) and `XDG_CONFIG_HOME` (Bun reads `$XDG_CONFIG_HOME/.npmrc`). A job
 * binding of one of them would hide the token the workflow stores there from the install.
 */
export const CI_NPM_USER_CONFIG_LOCATION_VARIABLES = Object.freeze(["HOME", "XDG_CONFIG_HOME"]);

/**
 * Uppercase prefixes of the variables through which npm, pnpm (`NPM_CONFIG_*`, read in any casing) and Bun
 * (`BUN_CONFIG_*`) take any setting from the environment, outranking the committed `.npmrc`: the registry, the
 * user or global config file, credentials and so on. None can be proven safe before dispatch, so the generated
 * workflow rejects every job binding with one of them whenever it hands the package manager the Actions token.
 */
export const CI_PACKAGE_MANAGER_CONFIG_VARIABLE_PREFIXES = Object.freeze(["NPM_CONFIG_", "BUN_CONFIG_"]);

/** Only URL protocol accepted for a GitHub Packages registry, so the workflow token never travels in clear text. */
export const CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL = "https:";

/** Quote character whose wrapped `.npmrc` key or value npm's INI parser decodes as a JSON string. */
export const NPM_CONFIG_JSON_QUOTE = '"';

/** `.npmrc` key selecting a registry, default (`registry`) or scoped (`@scope:registry`). */
export const NPM_CONFIG_REGISTRY_KEY_PATTERN = /^(?:@[^\s:]+:)?registry$/u;

/**
 * Every project `.npmrc` key bound to the GitHub Packages host, whatever its path or field (owner paths,
 * `certfile`, pnpm's `:@scope:_authToken`, array keys...). The host must end right there (followed by `/`,
 * `:` or nothing), so another host that only starts with the same name, such as `//npm.pkg.github.com.corp.example/`,
 * is not bound to GitHub Packages. Only `CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY` is accepted among them.
 */
export const NPM_CONFIG_GITHUB_PACKAGES_KEY_PATTERN = /^\/\/npm\.pkg\.github\.com(?:[/:]|$)/u;

/** Yarn Classic project config, which can select registries that the generated workflow cannot check. */
export const YARN_CLASSIC_CONFIG_FILE = ".yarnrc";

/**
 * `.yarnrc` line selecting a registry, default (`registry`) or scoped (`@scope:registry`), with or without
 * quotes or the `--` CLI form, separated from its value by whitespace or `:`.
 */
export const YARN_CLASSIC_CONFIG_REGISTRY_LINE_PATTERN = /^\s*(["']?)(?:--)?(?:@[^\s:"']+:)?registry\1(?=[\s:]|$)/u;

/** Yarn 2+ (Berry) project config, which ignores the runner's `~/.npmrc` where the generated step stores the token. */
export const YARN_BERRY_CONFIG_FILE = ".yarnrc.yml";

/**
 * `.yarnrc.yml` text configuring GitHub Packages or an npm credential (`npmAuthToken`, `npmAuthIdent`), which the
 * generated workflow cannot authenticate because Yarn 2+ does not read `~/.npmrc`.
 */
export const YARN_BERRY_CONFIG_GITHUB_PACKAGES_PATTERN = /npm\.pkg\.github\.com|npmAuthToken|npmAuthIdent/iu;

/** Bun project config, whose registries Bun reads besides the `.npmrc` checked by the generated workflow. */
export const BUN_CONFIG_FILE = "bunfig.toml";

/** Uncommented `bunfig.toml` line that mentions a registry or opens the `[install.scopes]` section. */
export const BUN_CONFIG_REGISTRY_LINE_PATTERN = /^(?!\s*#)(?:.*registry|\s*\[\s*install\.scopes\s*\])/u;

/** GitHub Packages origin over plain HTTP, named in the error about a lockfile that resolves packages from it. */
export const LOCKFILE_GITHUB_PACKAGES_HTTP_URL = "http://npm.pkg.github.com";

/** {@link LOCKFILE_GITHUB_PACKAGES_HTTP_URL} inside a lockfile, matched as text in any casing. */
export const LOCKFILE_GITHUB_PACKAGES_HTTP_URL_PATTERN = /http:\/\/npm\.pkg\.github\.com/iu;

/** `.npmrc` key that turns TLS certificate verification on or off. */
export const NPM_CONFIG_STRICT_SSL_KEY = "strict-ssl";

/** Effective `.npmrc` value that turns a boolean setting such as {@link NPM_CONFIG_STRICT_SSL_KEY} off. */
export const NPM_CONFIG_DISABLED_VALUE = "false";

/** Environment variables that turn off Node.js TLS certificate verification for every request of the install. */
export const CI_TLS_VERIFICATION_DISABLING_VARIABLES = Object.freeze(["NODE_TLS_REJECT_UNAUTHORIZED"]);

/** Indentation and marker opening each job step in the generated workflow. */
export const CI_WORKFLOW_STEP_PREFIX = "      - ";

/** Job-level binding of the built-in Actions token in the generated workflow. */
export const CI_GITHUB_TOKEN_JOB_BINDING = "      GITHUB_TOKEN: ${{ github.token }}";

/** Permission line the generated workflow adds to read or publish GitHub Packages. */
export const CI_GITHUB_PACKAGES_PERMISSION_LINE_PATTERN = /^ {2}packages: (?:read|write)$/u;

/** Value npm's INI parser gives a `.npmrc` key written without `=`. */
export const NPM_CONFIG_VALUELESS_KEY_VALUE = true;

/** Line terminators npm's INI parser splits a `.npmrc` on: CRLF, LF or a lone CR. */
export const NPM_CONFIG_LINE_BREAK_PATTERN = /\r\n|[\r\n]/u;

/** `.npmrc` value that is exactly one `${NAME}` environment reference; captures the variable name. */
export const NPM_CONFIG_ENVIRONMENT_REFERENCE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/** Every `${NAME}` environment reference inside a `.npmrc` value, as npm expands them; captures each variable name. */
export const NPM_CONFIG_ENVIRONMENT_REFERENCES_PATTERN = /\$\{([^${}]+)\}/gu;

/** Start of an inline comment in an unquoted `.npmrc` value (INI syntax: an unescaped `;` or `#`). */
export const NPM_CONFIG_INLINE_COMMENT_PATTERN = /(?<!\\)[;#]/u;

/**
 * `.npmrc` INI section header (`[name]`), matched against the raw, untrimmed line exactly as npm's INI parser
 * does: the bracket must open the line, the name cannot contain `]` and only whitespace may follow. npm nests
 * every later key under that section, so those keys never configure the top-level registries or credentials;
 * any other bracketed line (indented or malformed) is a plain key.
 */
export const NPM_CONFIG_SECTION_HEADER_PATTERN = /^\[[^\]]*\]\s*$/u;

/**
 * Suffix npm's INI parser removes from an array key (`key[]=value`), so the entry still configures `key`.
 * Keys bound to GitHub Packages keep it, so they are always rejected instead of read as their last assignment.
 */
export const NPM_CONFIG_ARRAY_KEY_SUFFIX = "[]";

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
  ...LOCKFILE_NAMES,
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
