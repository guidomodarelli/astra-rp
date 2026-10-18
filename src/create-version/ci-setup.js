/**
 * Prepares automatic CI setup as rollback-capable files of the release commit.
 * @module create-version/ci-setup
 */

import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CI_CONFIG_EXPORT, CI_DEFAULT_PNPM_VERSION, CI_DEFAULT_YARN_VERSION, CI_PACKAGE_MANAGER_VERSION_PATTERN, CI_RELEASE_TEMPLATE_FILE,
  CI_TEMPLATE_PLACEHOLDER, DEFAULT_CI_WORKFLOW,
  CI_RELEASE_METADATA_FILE, CI_VERCEL_CLI_VERSION, CI_VERCEL_DEPLOYMENT, CI_VERCEL_SECRETS,
  CI_VERCEL_CONFIG_FILE, CI_VERCEL_GATE_FILE, CI_VERCEL_GATE_TEMPLATE, CI_VERCEL_IGNORE_PLACEHOLDER, CI_VERCEL_WORKER_WRITTEN_PATHS,
  CI_DENO_JSR_CLIENT, CI_DENO_VERSION,
  CI_GITHUB_PACKAGES_AUTHENTICATION_STEP, CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY, CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL, CI_GITHUB_PACKAGES_TOKEN_VARIABLE, CI_NPM_USER_CONFIG_LOCATION_VARIABLES, CI_PACKAGE_MANAGER_CONFIG_VARIABLE_PREFIXES, CI_RUNNER_NPM_USER_CONFIG_PATH,
  NPM_CONFIG_ARRAY_KEY_SUFFIX, NPM_CONFIG_COMMENT_PREFIXES, NPM_CONFIG_JSON_QUOTE, NPM_CONFIG_LINE_BREAK_PATTERN, NPM_CONFIG_ENVIRONMENT_REFERENCE_PATTERN, NPM_CONFIG_ENVIRONMENT_REFERENCES_PATTERN, NPM_CONFIG_GITHUB_PACKAGES_KEY_PATTERN, NPM_CONFIG_INLINE_COMMENT_PATTERN, NPM_CONFIG_QUOTES, NPM_CONFIG_REGISTRY_KEY_PATTERN, NPM_CONFIG_SECTION_HEADER_PATTERN, NPM_CONFIG_VALUELESS_KEY_VALUE,
  CI_GITHUB_TOKEN_JOB_BINDING, CI_GITHUB_PACKAGES_AUTHENTICATED_PACKAGE_MANAGERS, CI_UNAUTHENTICATED_PACKAGE_MANAGER_CONFIG_FILES,
  GITHUB_PACKAGES_HOST_MENTION_PATTERN, PACKAGE_MANAGER_CONFIG_COMMENT_PREFIX, PNPM_WORKSPACE_CONFIG_FILE, PNPM_WORKSPACE_NETWORK_SETTING_LINE_PATTERN,
  CI_TLS_VERIFICATION_DISABLING_VARIABLES, LOCKFILE_GITHUB_PACKAGES_HTTP_URL, LOCKFILE_GITHUB_PACKAGES_HTTP_URL_PATTERN,
  NPM_CONFIG_DISABLED_VALUE, NPM_CONFIG_STRICT_SSL_KEY,
} from "../constants/ci-release.js";
import { CREATE_VERSION_CONFIG_FILES, CREATE_VERSION_FLAG, PINNED_NODE_VERSION_FILE, PROJECT_NPM_CONFIG_FILE, VERSION_PREFIX_PATTERN } from "../constants/create-version.js";
import { describeCreateVersionWithOptions } from "../package-manager.js";
import { LOCKFILE_NAMES, PACKAGE_MANAGER } from "../constants/package-manager.js";
import { ciWorkflowPath } from "./ci-config.js";
import { requiresCiPublicationHistory } from "./ci-publication-history.js";
import { isCommittedRegularFile, listCommittedTreeEntries, readCommittedFileEntry, readCommittedRegularFile } from "./committed-tree.js";
import { renderCiReleaseIdentityStep } from "./ci-release-identity-step.js";
import { ReleaseStepError } from "./errors.js";
import { readJsonManifest } from "./json.js";
import { runCaptured } from "./process.js";
import { GITHUB_PACKAGES_HOST, GITHUB_PACKAGES_REGISTRY_URL, GITHUB_REGISTRY_TOKEN_VARIABLE, JSR_REGISTRY_PROVIDER, NPM_OIDC_MINIMUM_VERSION, NPM_REGISTRY_PROVIDER, OIDC_AUTHENTICATION, TOKEN_AUTHENTICATION } from "../constants/registry.js";
import { GIT_LITERAL_PATHSPEC_PREFIX } from "../constants/version-files.js";

/**
 * @typedef {import("./config.js").ResolvedCreateVersionConfig} ResolvedCreateVersionConfig
 * @typedef {import("./run.js").ReleaseFileUpdate} ReleaseFileUpdate
 */

/**
 * Builds the worker's environment from explicit bindings and the selected registry credential.
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * Every Vercel credential is listed once in `secrets` (so preflight requires it) and always in
 * `deploymentSecrets`, even when also declared in `ci.secrets`, which keeps it out of the job-level environment.
 * @returns {{ secrets: string[], variables: string[], githubToken: boolean, githubTokenWrite: boolean, deploymentSecrets: string[] }} Required worker bindings, step-scoped deployment credentials and package permission.
 */
export function describeCiEnvironment(config) {
  const declaredSecrets = config.ci?.secrets ?? [];
  const variables = [...(config.ci?.variables ?? [])];
  const publicationTokenVariable = readPublicationTokenVariable(config);
  const publisherUsesGithubToken = publicationTokenVariable === GITHUB_REGISTRY_TOKEN_VARIABLE;
  const githubToken = publisherUsesGithubToken || declaredSecrets.includes(GITHUB_REGISTRY_TOKEN_VARIABLE);
  const secrets = declaredSecrets.filter((name) => !githubToken || name !== GITHUB_REGISTRY_TOKEN_VARIABLE);
  if (githubToken && variables.includes(GITHUB_REGISTRY_TOKEN_VARIABLE)) throw new ReleaseStepError("GITHUB_TOKEN es una credencial del workflow y no puede declararse en ci.variables.", "Usá ci.secrets para solicitar el token integrado de Actions o elegí otra variable de token.");
  if (publicationTokenVariable !== null && !publisherUsesGithubToken && !secrets.includes(publicationTokenVariable)) {
    secrets.push(publicationTokenVariable);
  }
  const deploymentSecrets = config.ci?.deployment === CI_VERCEL_DEPLOYMENT ? [...CI_VERCEL_SECRETS] : [];
  secrets.push(...deploymentSecrets.filter((name) => !secrets.includes(name)));
  if (secrets.some((name) => variables.includes(name))) throw new ReleaseStepError("Una credencial de publicación también figura en ci.variables.", "Guardala solo como secret; no se creó ningún archivo.");
  return { secrets, variables, githubToken, githubTokenWrite: publisherUsesGithubToken, deploymentSecrets };
}

/**
 * Reads the variable holding the publication token when a registry publisher authenticates with a
 * stored token instead of OIDC or a custom publish function.
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @returns {string | null} `publication.tokenEnv`, or `null` when the publication reads no token variable.
 */
function readPublicationTokenVariable(config) {
  const publishesToRegistry = Boolean(config.publish) && typeof config.publish !== "function";
  return publishesToRegistry && config.publication.authentication === TOKEN_AUTHENTICATION ? config.publication.tokenEnv : null;
}

/**
 * Reads the package manager version pinned by `packageManager`, the exact one the generated workflow installs.
 * @param {Record<string, unknown>} manifest - Parsed project `package.json`.
 * @returns {string | null} Pinned version such as `11.5.1`, or `null` when the field is absent or not a safe pin.
 */
export function extractPinnedPackageManagerVersion(manifest) {
  return typeof manifest.packageManager === "string" ? CI_PACKAGE_MANAGER_VERSION_PATTERN.exec(manifest.packageManager)?.[1] ?? null : null;
}

/**
 * Reads the major of the Node.js running setup, the runtime the generated workflow falls back to
 * when HEAD commits no `.nvmrc`.
 * @returns {string} Major version such as `22`.
 */
export function readRunningNodeMajor() {
  return process.versions.node.split(".")[0];
}

/**
 * Describes the Node.js version the generated workflow asks `actions/setup-node` for: the
 * `.nvmrc` pin when HEAD commits it as a regular file, otherwise the major of the Node.js running
 * setup. Only HEAD counts because the worker checks out the release commit built from it: an
 * untracked, ignored or set-aside `.nvmrc` would make `node-version-file` fail there after the tag
 * was pushed. Reading HEAD also keeps the rendered workflow deterministic for the drift check.
 * @param {string} repositoryRoot - Project checkout.
 * @returns {Promise<{ pinnedFile: string | null, version: string }>} Pin file the workflow reads (or `null`) and its version without a `v` prefix.
 * @throws {ReleaseStepError} When Git cannot list or read HEAD.
 */
export async function describeCiNodeVersion(repositoryRoot) {
  const committedPin = await readCommittedRegularFile(repositoryRoot, PINNED_NODE_VERSION_FILE);
  if (committedPin === null) return { pinnedFile: null, version: readRunningNodeMajor() };
  return { pinnedFile: PINNED_NODE_VERSION_FILE, version: committedPin.trim().replace(VERSION_PREFIX_PATTERN, "") };
}

/**
 * Tells whether the worker publishes to npm through OIDC with an npm client the workflow does not
 * otherwise control: a package manager other than npm, or npm without a `packageManager` pin.
 * Publication runs the npm CLI, whose Node-bundled version predates trusted publishing on most
 * runtimes, so the workflow installs a capable npm. A pinned npm is never replaced (it is checked
 * before tagging instead); an unpinned npm project gets the capable client only after `npm ci`, so
 * the client setup-node bundles keeps installing dependencies from the committed lockfile.
 * @param {ResolvedCreateVersionConfig} config - Release hooks and package manager.
 * @param {string | null} [pinnedVersion] - Version pinned by `packageManager`, from {@link extractPinnedPackageManagerVersion}.
 * @returns {boolean} True when the generated workflow must install the npm trusted publishing client.
 */
function requiresCiNpmOidcClient(config, pinnedVersion = null) {
  return config.publish === NPM_REGISTRY_PROVIDER && config.publication?.authentication === OIDC_AUTHENTICATION && (config.commands.packageManager !== PACKAGE_MANAGER.npm || pinnedVersion === null);
}

/**
 * Tells whether text is wrapped in a pair of the given quote character.
 * @param {string} text - Trimmed text.
 * @param {string} quote - One of {@link NPM_CONFIG_QUOTES}.
 * @returns {boolean} True when the text opens and closes with that quote.
 */
function isWrappedInQuote(text, quote) {
  return text.length > 1 && text[0] === quote && text.at(-1) === quote;
}

/**
 * Reads a raw `.npmrc` key or value the way npm's INI parser does for both: single quotes are removed
 * first, then text left wrapped in double quotes is decoded as a JSON string (Unicode escapes included)
 * or, when it is not valid JSON, is kept as is, double quotes included; unquoted text ends at an inline
 * `;` or `#` comment.
 * @param {string} rawText - Text before or after the first `=` of the line.
 * @returns {string} Effective key or value.
 */
function parseNpmConfigText(rawText) {
  const text = rawText.trim();
  const quote = NPM_CONFIG_QUOTES.find((candidate) => isWrappedInQuote(text, candidate));
  if (quote !== undefined) {
    const unquotedText = quote === NPM_CONFIG_JSON_QUOTE ? text : text.slice(1, -1);
    return isWrappedInQuote(unquotedText, NPM_CONFIG_JSON_QUOTE) ? decodeNpmConfigJsonString(unquotedText) : unquotedText;
  }
  const commentIndex = text.search(NPM_CONFIG_INLINE_COMMENT_PATTERN);
  return (commentIndex === -1 ? text : text.slice(0, commentIndex)).trim();
}

/**
 * Decodes a double-quoted `.npmrc` key or value as a JSON string, as npm's INI parser does.
 * @param {string} quotedText - Trimmed text wrapped in {@link NPM_CONFIG_JSON_QUOTE}.
 * @returns {string} Decoded text, or the original text with its double quotes when it is not a valid JSON string.
 */
function decodeNpmConfigJsonString(quotedText) {
  try {
    return JSON.parse(quotedText);
  } catch {
    // Not a valid JSON string (for example an unknown escape): npm keeps the text unchanged, quotes included.
    return quotedText;
  }
}

/**
 * Tells whether a project `.npmrc` key is bound to the GitHub Packages host, whatever its path, field or
 * value: any of them can change how the install authenticates there, and pnpm ignores repository
 * credentials, so the worker still needs the user-level token.
 * @param {string} key - Effective `.npmrc` key.
 * @returns {boolean} True for a key matching {@link NPM_CONFIG_GITHUB_PACKAGES_KEY_PATTERN}.
 */
function isGithubPackagesBoundKey(key) {
  return NPM_CONFIG_GITHUB_PACKAGES_KEY_PATTERN.test(key);
}

/**
 * Reads the effective top-level settings of a `.npmrc` the way npm's INI parser does: a repeated key
 * keeps its last assignment (compared after unquoting), and every key after an INI `[section]`
 * header ({@link NPM_CONFIG_SECTION_HEADER_PATTERN}, tested on the untrimmed line as npm does) is nested
 * under that section, so it never configures the top-level registries or credentials.
 * A key written without `=` gets {@link NPM_CONFIG_VALUELESS_KEY_VALUE}, as in npm, and lines end at
 * CRLF, LF or a lone CR ({@link NPM_CONFIG_LINE_BREAK_PATTERN}), as npm splits them. npm also drops the
 * {@link NPM_CONFIG_ARRAY_KEY_SUFFIX} of an INI array key longer than the suffix, so `key[]` configures `key`;
 * a key bound to GitHub Packages keeps the suffix so the policy rejects it whatever the other assignments.
 * @param {string} npmConfigText - Raw `.npmrc` contents.
 * @returns {Map<string, string | true>} Effective value of each top-level key, in first-assignment order.
 */
function readTopLevelNpmConfigEntries(npmConfigText) {
  /** @type {Map<string, string | true>} */
  const entries = new Map();
  for (const line of npmConfigText.split(NPM_CONFIG_LINE_BREAK_PATTERN)) {
    if (NPM_CONFIG_SECTION_HEADER_PATTERN.test(line)) break;
    const trimmedLine = line.trim();
    if (trimmedLine === "" || NPM_CONFIG_COMMENT_PREFIXES.some((prefix) => trimmedLine.startsWith(prefix))) continue;
    const separatorIndex = trimmedLine.indexOf("=");
    const key = parseNpmConfigText(separatorIndex === -1 ? trimmedLine : trimmedLine.slice(0, separatorIndex));
    const isArrayKey = key.length > NPM_CONFIG_ARRAY_KEY_SUFFIX.length && key.endsWith(NPM_CONFIG_ARRAY_KEY_SUFFIX) && !isGithubPackagesBoundKey(key);
    entries.set(isArrayKey ? key.slice(0, -NPM_CONFIG_ARRAY_KEY_SUFFIX.length) : key, separatorIndex === -1 ? NPM_CONFIG_VALUELESS_KEY_VALUE : parseNpmConfigText(trimmedLine.slice(separatorIndex + 1)));
  }
  return entries;
}

/**
 * Tells whether npm would expand a `${NAME}` environment reference inside a `.npmrc` key or value.
 * @param {string | true} text - Effective key or value; a valueless key has no references.
 * @returns {boolean} True when the text contains at least one reference.
 */
function containsNpmConfigEnvironmentReference(text) {
  return typeof text === "string" && text.search(NPM_CONFIG_ENVIRONMENT_REFERENCES_PATTERN) !== -1;
}

/**
 * Reads the variable of the only project credential the generated workflow accepts for GitHub
 * Packages: {@link CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY} whose whole value is one `${NAME}` reference.
 * @param {string | true | undefined} value - Effective value of that host token, if the `.npmrc` sets it.
 * @returns {string | null} `NAME`, or `null` when the value has any other form.
 */
function readAcceptedGithubPackagesTokenVariable(value) {
  return typeof value === "string" ? NPM_CONFIG_ENVIRONMENT_REFERENCE_PATTERN.exec(value)?.[1] ?? null : null;
}

/**
 * Tells whether a `.npmrc` entry selects GitHub Packages as the default or a scoped registry.
 * @param {string} key - Effective `.npmrc` key.
 * @param {string | true} value - Effective value.
 * @returns {boolean} True for a registry key whose URL host is GitHub Packages.
 */
function selectsGithubPackagesRegistry(key, value) {
  return NPM_CONFIG_REGISTRY_KEY_PATTERN.test(key) && typeof value === "string" && URL.canParse(value) && new URL(value).host === GITHUB_PACKAGES_HOST;
}

/**
 * @typedef {object} ProjectGithubPackagesConfig
 * @property {boolean} usesGithubPackages - A literal registry or any project credential selects GitHub Packages.
 * @property {string | null} tokenVariable - Variable expanded by the accepted host token (`${NAME}`), or `null`.
 * @property {Array<{ key: string, value: string | true }>} entries - Effective top-level entries, validated by
 *   {@link assertProjectNpmConfigEntriesSupported}.
 * @property {string | null} irregularFileMode - Git tree mode of a committed `.npmrc` that is not a regular file
 *   (a symlink, `120000`, or another kind of entry), which npm still follows in the worker; `null` otherwise.
 */

/**
 * @typedef {object} CommittedPackageManagerFile
 * @property {string} filePath - Root-relative path of the file committed at HEAD.
 * @property {string | null} text - Committed content, or `null` when the entry is not a regular file.
 * @property {string | null} irregularFileMode - Git tree mode of an entry that is not a regular file (a symlink,
 *   `120000`, or another kind of entry), which the package manager still follows in the worker; `null` otherwise.
 */

/**
 * Reads the package manager files committed at HEAD. Only HEAD counts because the worker
 * checks out the release commit; an absent path is omitted.
 * @param {string} repositoryRoot - Project checkout.
 * @param {string[]} filePaths - Root-relative paths to read.
 * @returns {Promise<CommittedPackageManagerFile[]>} Committed files found at HEAD.
 * @throws {ReleaseStepError} When Git cannot list or read HEAD.
 */
async function readCommittedPackageManagerFiles(repositoryRoot, filePaths) {
  const entries = await listCommittedTreeEntries(repositoryRoot, filePaths);
  return Promise.all(entries.map(async (entry) => isCommittedRegularFile(entry)
    ? { filePath: entry.filePath, text: await readCommittedFileEntry(repositoryRoot, entry), irregularFileMode: null }
    : { filePath: entry.filePath, text: null, irregularFileMode: entry.mode }));
}

/**
 * Rejects a committed package manager file that is not a regular file once the workflow hands the package manager
 * the GitHub Packages token: HEAD only stores its target, so its registries cannot be checked before the bump.
 * @param {CommittedPackageManagerFile} file - Committed file description.
 * @returns {void}
 * @throws {ReleaseStepError} When the file is not a regular file.
 */
function assertCommittedPackageManagerFileRegular(file) {
  if (file.irregularFileMode === null) return;
  throwCommittedFileError(file.filePath, `no es un archivo regular (modo ${file.irregularFileMode}); el package manager lo seguiría en el worker de CI y antes del bump no se puede comprobar qué registry usa con el token de GitHub Packages.`, "Reemplazalo por un archivo regular");
}

/**
 * Reads the uncommented lines of a committed package manager config: a line whose trimmed text starts with
 * {@link PACKAGE_MANAGER_CONFIG_COMMENT_PREFIX} is a comment and configures nothing.
 * @param {CommittedPackageManagerFile} file - Committed file description.
 * @returns {string[]} Uncommented lines, or none when the entry is not a regular file.
 */
function readUncommentedConfigLines(file) {
  return (file.text?.split(NPM_CONFIG_LINE_BREAK_PATTERN) ?? []).filter((line) => !line.trim().startsWith(PACKAGE_MANAGER_CONFIG_COMMENT_PREFIX));
}

/**
 * Rejects a GitHub Packages setup for a package manager the generated workflow does not authenticate (Yarn of any
 * version or Bun): each reads registries and credentials from its own config files and environment variables, which
 * the workflow cannot validate before handing it the Actions token. Besides the shared signals (see
 * {@link readsGithubPackages}), an uncommented mention of the GitHub Packages host in the package manager's own
 * committed config (see {@link CI_UNAUTHENTICATED_PACKAGE_MANAGER_CONFIG_FILES}) counts as a signal. npm and pnpm
 * never read the config files of other package managers, so those files are not inspected for them.
 * @param {string} repositoryRoot - Project checkout.
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @param {boolean} sharedSignal - Whether a declared `GITHUB_TOKEN` or the committed `.npmrc` selects GitHub Packages.
 * @returns {Promise<void>}
 * @throws {ReleaseStepError} When Git cannot list or read HEAD or such a project uses GitHub Packages.
 */
async function assertPackageManagerAuthenticatesGithubPackages(repositoryRoot, config, sharedSignal) {
  const manager = config.commands.packageManager;
  if (CI_GITHUB_PACKAGES_AUTHENTICATED_PACKAGE_MANAGERS.includes(manager)) return;
  const ownConfigFiles = await readCommittedPackageManagerFiles(repositoryRoot, [...(CI_UNAUTHENTICATED_PACKAGE_MANAGER_CONFIG_FILES[manager] ?? [])]);
  const configuredFile = ownConfigFiles.find((file) => readUncommentedConfigLines(file).some((line) => GITHUB_PACKAGES_HOST_MENTION_PATTERN.test(line)));
  if (!sharedSignal && configuredFile === undefined) return;
  const signal = configuredFile === undefined ? `ci.secrets declara ${GITHUB_REGISTRY_TOKEN_VARIABLE} o el ${PROJECT_NPM_CONFIG_FILE} commiteado usa GitHub Packages` : `el ${configuredFile.filePath} commiteado usa GitHub Packages`;
  throw new ReleaseStepError(
    `El workflow generado solo autentica GitHub Packages con npm o pnpm y el proyecto usa ${manager}, pero ${signal}; ${manager} lee registries y credenciales de su propia configuración y el workflow no puede comprobarlos antes de darle el token de Actions.`,
    `Usá un workflow propio en ci.workflow que autentique ${manager} con GitHub Packages, o quitá la configuración de GitHub Packages; no se cambió ningún archivo.`,
  );
}

/**
 * Rejects the package manager files that could send the GitHub Packages token somewhere unchecked once the workflow
 * hands it to the install: any of them that is not a regular file, a `pnpm-workspace.yaml` that defines registries
 * or network settings (see {@link PNPM_WORKSPACE_NETWORK_SETTING_LINE_PATTERN}), and a lockfile that resolves GitHub
 * Packages over plain HTTP.
 * @param {CommittedPackageManagerFile[]} files - Committed package manager files.
 * @returns {void}
 * @throws {ReleaseStepError} When one of those files is found.
 */
function assertCommittedPackageManagerFilesSupported(files) {
  for (const file of files) {
    assertCommittedPackageManagerFileRegular(file);
    if (file.filePath === PNPM_WORKSPACE_CONFIG_FILE && readUncommentedConfigLines(file).some((line) => PNPM_WORKSPACE_NETWORK_SETTING_LINE_PATTERN.test(line))) {
      throwCommittedFileError(
        PNPM_WORKSPACE_CONFIG_FILE,
        `define registries o ajustes de red (registry, registries, strictSsl, ca, cert, key o proxies); pnpm los usaría en el worker de CI con el token de GitHub Packages y el workflow generado solo valida los registries del ${PROJECT_NPM_CONFIG_FILE}.`,
        `Mové el registry al ${PROJECT_NPM_CONFIG_FILE} commiteado con una URL literal ${CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL}//, quitá esos ajustes del ${PNPM_WORKSPACE_CONFIG_FILE} sin desactivar la verificación TLS`,
      );
    }
    if (LOCKFILE_NAMES.includes(file.filePath) && LOCKFILE_GITHUB_PACKAGES_HTTP_URL_PATTERN.test(file.text ?? "")) {
      throwCommittedFileError(
        file.filePath,
        `resuelve paquetes desde ${LOCKFILE_GITHUB_PACKAGES_HTTP_URL}; la instalación le enviaría el token de GitHub Packages sin cifrar.`,
        `Regenerá el lockfile con el registry ${GITHUB_PACKAGES_REGISTRY_URL} (${CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL}//)`,
      );
    }
  }
}

/**
 * Rejects a committed `.npmrc` whose effective `strict-ssl` is `false` once the workflow hands npm the GitHub
 * Packages token: without TLS verification anyone on the network path could read it.
 * @param {ProjectGithubPackagesConfig} projectGithubPackages - Committed `.npmrc` description.
 * @returns {void}
 * @throws {ReleaseStepError} When TLS verification is disabled.
 */
function assertProjectNpmConfigVerifiesTls(projectGithubPackages) {
  if (!projectGithubPackages.entries.some(({ key, value }) => key === NPM_CONFIG_STRICT_SSL_KEY && value === NPM_CONFIG_DISABLED_VALUE)) return;
  throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `define ${NPM_CONFIG_STRICT_SSL_KEY}=${NPM_CONFIG_DISABLED_VALUE}, que desactiva la verificación TLS; el token de GitHub Packages podría quedar expuesto en la instalación.`, `Quitá ${NPM_CONFIG_STRICT_SSL_KEY}=${NPM_CONFIG_DISABLED_VALUE}`);
}

/**
 * Describes how the `.npmrc` committed at HEAD reaches GitHub Packages, which the worker cannot
 * install from anonymously. Only HEAD counts because the worker checks out the release commit: an
 * untracked or ignored `.npmrc` never reaches it. Only the effective top-level values count (see
 * {@link readTopLevelNpmConfigEntries}): a later assignment replaces an earlier one, as in npm.
 * A committed `.npmrc` that is not a regular file is only recorded in `irregularFileMode`, since its
 * content cannot be read from HEAD. It only describes the file; whether the generated workflow supports
 * it is decided by {@link assertGeneratedGithubPackagesSetupSupported}.
 * @param {string} repositoryRoot - Project checkout.
 * @returns {Promise<ProjectGithubPackagesConfig>} How the committed `.npmrc` reaches GitHub Packages.
 * @throws {ReleaseStepError} When Git cannot list or read HEAD.
 */
async function describeProjectGithubPackagesConfig(repositoryRoot) {
  /** @type {ProjectGithubPackagesConfig} */
  const description = { usesGithubPackages: false, tokenVariable: null, entries: [], irregularFileMode: null };
  const [npmConfigFile] = await readCommittedPackageManagerFiles(repositoryRoot, [PROJECT_NPM_CONFIG_FILE]);
  if (npmConfigFile === undefined) return description;
  if (npmConfigFile.text === null) {
    description.irregularFileMode = npmConfigFile.irregularFileMode;
    return description;
  }
  const npmConfigEntries = readTopLevelNpmConfigEntries(npmConfigFile.text);
  description.entries = [...npmConfigEntries].map(([key, value]) => ({ key, value }));
  description.usesGithubPackages = description.entries.some(({ key, value }) => selectsGithubPackagesRegistry(key, value) || isGithubPackagesBoundKey(key));
  description.tokenVariable = readAcceptedGithubPackagesTokenVariable(npmConfigEntries.get(CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY));
  return description;
}

/**
 * Applies the closed `.npmrc` policy of the generated workflow, entry by entry, before the bump:
 * - the committed `.npmrc` must be a regular file;
 * - no key may contain `${...}` and no registry may read `${...}`, because npm expands them and their
 *   host cannot be known before the bump;
 * - a literal GitHub Packages registry must use {@link CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL};
 * - the only accepted key bound to the GitHub Packages host is {@link CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY}`=${NAME}`,
 *   whose `NAME` must be allowed (see {@link assertGithubPackagesTokenVariableAllowed}).
 * @param {ProjectGithubPackagesConfig} projectGithubPackages - Committed `.npmrc` description.
 * @returns {void}
 * @throws {ReleaseStepError} When an entry is outside the policy.
 */
function assertProjectNpmConfigEntriesSupported(projectGithubPackages) {
  assertProjectNpmConfigRegularFile(projectGithubPackages.irregularFileMode);
  for (const { key, value } of projectGithubPackages.entries) {
    if (containsNpmConfigEnvironmentReference(key)) throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `define la clave ${key}, que npm completa con variables de entorno; antes del bump no se puede saber a qué host apunta ni si reemplazaría el token del workflow.`, `Escribí la clave literal (por ejemplo ${CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY}) o quitá la línea`);
    const isRegistryKey = NPM_CONFIG_REGISTRY_KEY_PATTERN.test(key);
    if (isRegistryKey && containsNpmConfigEnvironmentReference(value)) throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `define ${key} con una variable de entorno; antes del bump no se puede comprobar si apunta a GitHub Packages ni que use ${CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL}.`, `Escribí la URL literal ${CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL}// del registry`);
    if (selectsGithubPackagesRegistry(key, value) && new URL(/** @type {string} */ (value)).protocol !== CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL) {
      throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `define ${key} con GitHub Packages sobre ${new URL(/** @type {string} */ (value)).protocol}; el workflow le daría a npm el token de Actions y npm lo enviaría sin cifrar.`, `Usá ${GITHUB_PACKAGES_REGISTRY_URL} como registry`);
    }
    if (isGithubPackagesBoundKey(key) && (key !== CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY || readAcceptedGithubPackagesTokenVariable(value) === null)) {
      throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `define la credencial ${key} con una forma que el workflow generado no acepta: solo admite ${CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY}=\${NOMBRE}, porque cualquier otra credencial de GitHub Packages podría tener prioridad sobre el token de Actions y la instalación fallaría con 401.`, `Usá ${CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY}=\${${GITHUB_REGISTRY_TOKEN_VARIABLE}} o quitá la línea`);
    }
  }
}

/**
 * Throws a {@link ReleaseStepError} about a file committed at HEAD with the shared closing instructions.
 * @param {string} filePath - Root-relative path of the committed file.
 * @param {string} problem - Spanish description following "El <archivo> commiteado ".
 * @param {string} action - Spanish instruction the hint starts with.
 * @returns {never}
 * @throws {ReleaseStepError} Always.
 */
function throwCommittedFileError(filePath, problem, action) {
  throw new ReleaseStepError(`El ${filePath} commiteado ${problem}`, `${action}, commiteá el cambio y volvé a correr el comando; no se cambió ningún archivo.`);
}

/**
 * Rejects a committed `.npmrc` that is not a regular file, such as a symlink: HEAD only stores its
 * target, so its settings cannot be checked before the bump, yet npm follows it in the worker.
 * @param {string | null} irregularFileMode - Git tree mode of the committed `.npmrc`, or `null` when it is regular or absent.
 * @returns {void}
 * @throws {ReleaseStepError} When the committed `.npmrc` is not a regular file.
 */
function assertProjectNpmConfigRegularFile(irregularFileMode) {
  if (irregularFileMode === null) return;
  throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `no es un archivo regular (modo ${irregularFileMode}, por ejemplo un enlace simbólico); npm lo seguiría en el worker de CI y antes del bump no se puede comprobar qué registries ni credenciales usa.`, "Reemplazalo por un archivo regular con la configuración de npm");
}

/**
 * Rejects bindings the generated workflow cannot combine with GitHub Packages, before anything is
 * written: each would make the dependency install send a wrong credential, none, or send the Actions
 * token somewhere unchecked.
 * - With the token step, a job binding of {@link CI_NPM_USER_CONFIG_LOCATION_VARIABLES} moves the user config
 *   away from the runner's `~/.npmrc`, where the step stores the token, and any binding whose name starts, in any
 *   casing, with one of {@link CI_PACKAGE_MANAGER_CONFIG_VARIABLE_PREFIXES} overrides the committed `.npmrc`
 *   (registry, config files, credentials) with a value that cannot be checked before dispatch.
 * - With the token step, a binding of {@link CI_TLS_VERIFICATION_DISABLING_VARIABLES} turns off TLS verification.
 * - The accepted token must expand an allowed variable (see {@link assertGithubPackagesTokenVariableAllowed}).
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @param {{ githubToken: boolean, deploymentSecrets: string[] }} environment - Worker bindings from {@link describeCiEnvironment}.
 * @param {ProjectGithubPackagesConfig} projectGithubPackages - Committed `.npmrc` description.
 * @param {boolean} authenticatesGithubPackages - Whether the workflow adds the token step (see {@link readsGithubPackages}).
 * @returns {void}
 * @throws {ReleaseStepError} When any of those setups is found.
 */
function assertGithubPackagesSetupSupported(config, environment, projectGithubPackages, authenticatesGithubPackages) {
  const declaredNames = [...(config.ci?.secrets ?? []), ...(config.ci?.variables ?? [])];
  const configurationVariable = declaredNames.find((name) => CI_NPM_USER_CONFIG_LOCATION_VARIABLES.includes(name) || CI_PACKAGE_MANAGER_CONFIG_VARIABLE_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)));
  if (authenticatesGithubPackages && configurationVariable !== undefined) {
    throw new ReleaseStepError(
      `ci.secrets o ci.variables declara ${configurationVariable}, que cambia la configuración del package manager o dónde la busca; el workflow guarda el token de GitHub Packages en ~/.npmrc del runner y antes del bump no se puede comprobar qué registry ni qué credencial usaría la instalación de dependencias.`,
      `Quitá ${configurationVariable} de ci.secrets y ci.variables (el workflow usa ${CI_RUNNER_NPM_USER_CONFIG_PATH}) y definí registries y credenciales en el ${PROJECT_NPM_CONFIG_FILE} commiteado, con URLs literales ${CI_GITHUB_PACKAGES_REGISTRY_PROTOCOL}//; no se cambió ningún archivo.`,
    );
  }
  const tlsDisablingVariable = declaredNames.find((name) => CI_TLS_VERIFICATION_DISABLING_VARIABLES.includes(name));
  if (authenticatesGithubPackages && tlsDisablingVariable !== undefined) {
    throw new ReleaseStepError(
      `ci.secrets o ci.variables declara ${tlsDisablingVariable}, que desactiva la verificación TLS de Node.js; la instalación de dependencias podría exponer el token de GitHub Packages.`,
      `Quitá ${tlsDisablingVariable} de ci.secrets y ci.variables y volvé a correr el comando; no se cambió ningún archivo.`,
    );
  }
  if (projectGithubPackages.tokenVariable !== null) assertGithubPackagesTokenVariableAllowed(config, projectGithubPackages.tokenVariable, environment.deploymentSecrets);
}

/**
 * Applies the allowlist of the variable expanded by the accepted GitHub Packages token (`${NAME}`):
 * - `GITHUB_TOKEN`, which the job binds to the Actions token, unless `ci.variables` declares it (that
 *   repository variable would replace the Actions token);
 * - a secret declared in `ci.secrets`, which the job already binds from that secret, unless it is a
 *   deployment secret (only the Vercel steps get it, with their own value) or `publication.tokenEnv`
 *   (npm would send the publication token to GitHub Packages).
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @param {string} tokenVariable - Variable the accepted token expands.
 * @param {readonly string[]} deploymentSecrets - Credentials the deployment steps bind themselves (see {@link describeCiEnvironment}).
 * @returns {void}
 * @throws {ReleaseStepError} When the variable is outside the allowlist.
 */
function assertGithubPackagesTokenVariableAllowed(config, tokenVariable, deploymentSecrets) {
  if (tokenVariable === GITHUB_REGISTRY_TOKEN_VARIABLE) {
    if (!(config.ci?.variables ?? []).includes(GITHUB_REGISTRY_TOKEN_VARIABLE)) return;
    throw new ReleaseStepError(
      `El ${PROJECT_NPM_CONFIG_FILE} commiteado usa \${${GITHUB_REGISTRY_TOKEN_VARIABLE}} como token de GitHub Packages y ci.variables declara ${GITHUB_REGISTRY_TOKEN_VARIABLE}; el workflow lo cargaría con esa variable del repositorio en vez del token de Actions y la instalación de GitHub Packages fallaría con 401.`,
      `Quitá ${GITHUB_REGISTRY_TOKEN_VARIABLE} de ci.variables (el workflow le da el token de Actions) y volvé a correr el comando; no se cambió ningún archivo.`,
    );
  }
  const usesVariable = `usa \${${tokenVariable}} como token de GitHub Packages`;
  const allowedVariableHint = `Usá \${${GITHUB_REGISTRY_TOKEN_VARIABLE}} o declará el secret en ci.secrets`;
  if (!(config.ci?.secrets ?? []).includes(tokenVariable)) {
    throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `${usesVariable}, que no es ${GITHUB_REGISTRY_TOKEN_VARIABLE} ni un secret declarado en ci.secrets; el workflow no le daría ningún token y la instalación de GitHub Packages fallaría o enviaría otro valor.`, allowedVariableHint);
  }
  if (deploymentSecrets.includes(tokenVariable)) {
    throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `${usesVariable}, un secret del despliegue de Vercel; solo los pasos de Vercel lo reciben, con su propio valor, así que la instalación de vercel build enviaría ese secret como token de GitHub Packages.`, `${allowedVariableHint} que no sea ${deploymentSecrets.join(", ")}`);
  }
  if (tokenVariable === readPublicationTokenVariable(config)) {
    throwCommittedFileError(PROJECT_NPM_CONFIG_FILE, `${usesVariable}, el mismo nombre que publication.tokenEnv; el workflow lo carga con el secret de publicación y la instalación de dependencias enviaría ese token a GitHub Packages.`, `Usá \${${GITHUB_REGISTRY_TOKEN_VARIABLE}} en el ${PROJECT_NPM_CONFIG_FILE} o renombrá el secret de publicación (publication.tokenEnv)`);
  }
}

/**
 * Renders the step that stores the GitHub Packages token in the runner's user npm config (`~/.npmrc`),
 * so the dependency install and the later `vercel build` install can read GitHub Packages. pnpm ignores
 * credentials in the repository `.npmrc`, so the job-level binding alone is not enough. The stored token is
 * the one the committed `.npmrc` expands: its own secret when that variable is declared in `ci.secrets`
 * (other than `GITHUB_TOKEN`), otherwise the built-in Actions token. Bindings that move that config are
 * rejected by {@link assertGithubPackagesSetupSupported}.
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @param {string | null} tokenVariable - Variable expanded by the accepted host token, or `null`.
 * @returns {string} Workflow step lines.
 */
function renderGithubPackagesAuthenticationStep(config, tokenVariable) {
  const usesOwnSecret = tokenVariable !== null && tokenVariable !== GITHUB_REGISTRY_TOKEN_VARIABLE && (config.ci?.secrets ?? []).includes(tokenVariable);
  const tokenExpression = usesOwnSecret ? `secrets.${tokenVariable}` : "github.token";
  return [
    `      - name: ${CI_GITHUB_PACKAGES_AUTHENTICATION_STEP}`, "        env:", `          ${CI_GITHUB_PACKAGES_TOKEN_VARIABLE}: \${{ ${tokenExpression} }}`,
    `        run: printf '${CI_GITHUB_PACKAGES_AUTH_TOKEN_KEY}=%s\\n' "$${CI_GITHUB_PACKAGES_TOKEN_VARIABLE}" >> "${CI_RUNNER_NPM_USER_CONFIG_PATH}"`,
  ].join("\n");
}

/**
 * Rejects a GitHub Packages setup the generated workflow cannot authenticate: unsupported committed
 * `.npmrc` entries (see {@link assertProjectNpmConfigEntriesSupported}) and bindings or references
 * it cannot resolve (see {@link assertGithubPackagesSetupSupported}). It applies only to the generated
 * workflow; a customized workflow authenticates on its own. Only npm and pnpm are authenticated: Yarn and
 * Bun with any GitHub Packages signal are rejected (see {@link assertPackageManagerAuthenticatesGithubPackages}).
 * With the authentication step, TLS settings, lockfiles and, for pnpm, `pnpm-workspace.yaml` are checked too.
 * @param {string} repositoryRoot - Project checkout.
 * @param {ResolvedCreateVersionConfig} config - Project configuration.
 * @param {ReturnType<typeof describeCiEnvironment>} environment - Worker bindings.
 * @param {ProjectGithubPackagesConfig} projectGithubPackages - Committed `.npmrc` description.
 * @param {boolean} authenticatesGithubPackages - Whether the workflow adds the token step (see {@link readsGithubPackages}).
 * @returns {Promise<void>}
 * @throws {ReleaseStepError} When Git cannot list or read HEAD or the setup is unsupported.
 */
async function assertGeneratedGithubPackagesSetupSupported(repositoryRoot, config, environment, projectGithubPackages, authenticatesGithubPackages) {
  assertProjectNpmConfigEntriesSupported(projectGithubPackages);
  await assertPackageManagerAuthenticatesGithubPackages(repositoryRoot, config, authenticatesGithubPackages);
  assertGithubPackagesSetupSupported(config, environment, projectGithubPackages, authenticatesGithubPackages);
  if (!authenticatesGithubPackages) return;
  assertProjectNpmConfigVerifiesTls(projectGithubPackages);
  const workspaceConfigFiles = config.commands.packageManager === PACKAGE_MANAGER.pnpm ? [PNPM_WORKSPACE_CONFIG_FILE] : [];
  assertCommittedPackageManagerFilesSupported(await readCommittedPackageManagerFiles(repositoryRoot, [...workspaceConfigFiles, ...LOCKFILE_NAMES]));
}

/**
 * Tells whether the generated workflow hands the dependency install the GitHub Packages token.
 * @param {{ githubToken: boolean }} environment - Worker bindings from {@link describeCiEnvironment}.
 * @param {ProjectGithubPackagesConfig} projectGithubPackages - Committed `.npmrc` description.
 * @returns {boolean} True when a declared `GITHUB_TOKEN` or the committed `.npmrc` selects GitHub Packages.
 */
function readsGithubPackages(environment, projectGithubPackages) {
  return environment.githubToken || projectGithubPackages.usesGithubPackages;
}

/**
 * Renders the steps that install the package manager and the project dependencies, before the GitHub
 * Packages authentication is prepended.
 * @param {ResolvedCreateVersionConfig["commands"]["packageManager"]} manager - Package manager of the project.
 * @param {string | null} pinnedVersion - Version pinned by `packageManager`, or `null`.
 * @param {string[]} npmOidcClientSetup - Step lines that install the npm trusted publishing client, or none.
 * @returns {string} Workflow step lines.
 */
function renderPackageSetup(manager, pinnedVersion, npmOidcClientSetup) {
  if (manager === PACKAGE_MANAGER.pnpm) {
    return ["      - name: Configurar pnpm", "        uses: pnpm/action-setup@v4", "        with:", `          version: '${pinnedVersion ?? CI_DEFAULT_PNPM_VERSION}'`, "      - name: Instalar dependencias", "        run: pnpm install --frozen-lockfile"].join("\n");
  }
  if (manager === PACKAGE_MANAGER.bun) {
    return ["      - name: Configurar Bun", "        uses: oven-sh/setup-bun@v2", ...(pinnedVersion ? ["        with:", `          bun-version: '${pinnedVersion}'`] : []), "      - name: Instalar dependencias", "        run: bun install --frozen-lockfile"].join("\n");
  }
  if (manager === PACKAGE_MANAGER.yarn) {
    // Yarn 2+ (Berry) ships as @yarnpkg/cli-dist and replaced --frozen-lockfile with --immutable.
    const yarnBerry = pinnedVersion !== null && Number(pinnedVersion.split(".")[0]) > 1;
    return ["      - name: Configurar Yarn", `        run: npm install --global ${yarnBerry ? "@yarnpkg/cli-dist" : "yarn"}@${pinnedVersion ?? CI_DEFAULT_YARN_VERSION}`, "      - name: Instalar dependencias", `        run: yarn install ${yarnBerry ? "--immutable" : "--frozen-lockfile"}`].join("\n");
  }
  return [...(pinnedVersion ? ["      - name: Configurar npm", `        run: npm install --global npm@${pinnedVersion}`] : []), "      - name: Instalar dependencias", "        run: npm ci", ...npmOidcClientSetup].join("\n");
}

/**
 * Renders the Vercel steps of a workflow that deploys after the worker: the CLI setup, and the
 * production pull, build and deploy, each with its own credentials.
 * @param {boolean} deploysToVercel - Whether `ci.deployment` is Vercel.
 * @returns {{ deploymentSetup: string, deployment: string }} Workflow step lines, empty without Vercel.
 */
function renderVercelSteps(deploysToVercel) {
  if (!deploysToVercel) return { deploymentSetup: "", deployment: "" };
  const vercelEnvironment = CI_VERCEL_SECRETS.map((name) => `          ${name}: \${{ secrets.${name} }}`).join("\n");
  return {
    deploymentSetup: ["      - name: Configurar Vercel", `        run: npm install --global vercel@${CI_VERCEL_CLI_VERSION}`].join("\n"),
    // Production values are pulled only after checks, migrations and hooks finish, so release code never receives them.
    deployment: ["      - name: Obtener entorno de producción", "        env:", vercelEnvironment, "        run: |", '          vercel pull --yes --environment=production --token="$VERCEL_TOKEN"', "          cp .vercel/.env.production.local .env","      - name: Construir artefacto de producción", "        env:", vercelEnvironment, '        run: vercel build --prod --token="$VERCEL_TOKEN"', "      - name: Desplegar producción después de los checks", "        env:", vercelEnvironment, '        run: vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"'].join("\n"),
  };
}

/**
 * Renders the release workflow and keeps the GitHub Packages description it was rendered from, so a caller
 * can compare the workflow first and validate that setup afterwards without describing it twice.
 * @param {string} repositoryRoot - Project checkout.
 * @param {ResolvedCreateVersionConfig} config - Release hooks and package manager.
 * @returns {Promise<{ content: string, assertGithubPackagesSetupSupported: () => Promise<void> }>} GitHub Actions YAML,
 *   and the check that the generated workflow can authenticate the project's GitHub Packages setup.
 * @throws {ReleaseStepError} When Git cannot list or read HEAD or the worker bindings are invalid.
 */
export async function prepareCiReleaseWorkflow(repositoryRoot, config) {
  const manifest = readJsonManifest(repositoryRoot);
  const manager = config.commands.packageManager;
  const pinnedVersion = extractPinnedPackageManagerVersion(manifest);
  const nodeVersion = await describeCiNodeVersion(repositoryRoot);
  const npmOidcClientSetup = requiresCiNpmOidcClient(config, pinnedVersion) ? ["      - name: Configurar npm para trusted publishing", `        run: npm install --global npm@${NPM_OIDC_MINIMUM_VERSION}`] : [];
  const nodeSetup = [
    "      - name: Configurar Node.js", "        uses: actions/setup-node@v4", "        with:",
    nodeVersion.pinnedFile ? `          node-version-file: '${nodeVersion.pinnedFile}'` : `          node-version: '${nodeVersion.version}'`,
    // npm projects install their dependencies with the bundled client and get this one afterwards.
    ...(manager === PACKAGE_MANAGER.npm ? [] : npmOidcClientSetup),
  ].join("\n");
  const environment = describeCiEnvironment(config);
  const projectGithubPackages = await describeProjectGithubPackagesConfig(repositoryRoot);
  const authenticatesGithubPackages = readsGithubPackages(environment, projectGithubPackages);
  const packageSetup = renderPackageSetup(manager, pinnedVersion, npmOidcClientSetup);
  const authenticatedPackageSetup = authenticatesGithubPackages ? `${renderGithubPackagesAuthenticationStep(config, projectGithubPackages.tokenVariable)}\n${packageSetup}` : packageSetup;
  const readsPublicationHistory = requiresCiPublicationHistory(config);
  // The worker reads its own Actions history, and npm prefers a project `${GITHUB_TOKEN}` host token over ~/.npmrc;
  // any other accepted token variable is a declared secret, already bound from it.
  const bindsGithubToken = environment.githubToken || readsPublicationHistory || projectGithubPackages.tokenVariable === GITHUB_REGISTRY_TOKEN_VARIABLE;
  // Deployment secrets are bound only on their own steps; a project credential expanding one is rejected by the validation.
  const jobSecrets = environment.secrets.filter((name) => !environment.deploymentSecrets.includes(name));
  const bindings = [
    ...jobSecrets.map((name) => `      ${name}: \${{ secrets.${name} }}`),
    ...environment.variables.map((name) => `      ${name}: \${{ vars.${name} }}`),
    ...(bindsGithubToken ? [CI_GITHUB_TOKEN_JOB_BINDING] : []),
  ];
  const permissions = [
    ...(readsPublicationHistory ? ["  actions: read"] : []),
    ...(config.publication.authentication === OIDC_AUTHENTICATION ? ["  id-token: write"] : []),
    ...(authenticatesGithubPackages ? [`  packages: ${environment.githubTokenWrite ? "write" : "read"}`] : []),
  ].join("\n");
  const releaseCommand = `${describeCreateVersionWithOptions(config.commands)} --${CREATE_VERSION_FLAG.ciRelease} "$RELEASE_TAG"`;
  const { deploymentSetup, deployment } = renderVercelSteps(config.ci?.deployment === CI_VERCEL_DEPLOYMENT);
  const deno = config.publication.jsrClient === CI_DENO_JSR_CLIENT && config.publish === JSR_REGISTRY_PROVIDER ? ["      - name: Configurar Deno para JSR", "        uses: denoland/setup-deno@v2", "        with:", `          deno-version: '${CI_DENO_VERSION}'`].join("\n") : "";
  const content = readFileSync(new URL(CI_RELEASE_TEMPLATE_FILE, import.meta.url), "utf8")
    .replace(CI_TEMPLATE_PLACEHOLDER.identity, () => renderCiReleaseIdentityStep())
    .replace(CI_TEMPLATE_PLACEHOLDER.node, nodeSetup)
    .replace(CI_TEMPLATE_PLACEHOLDER.install, authenticatedPackageSetup)
    .replace(CI_TEMPLATE_PLACEHOLDER.environment, bindings.join("\n"))
    .replace(CI_TEMPLATE_PLACEHOLDER.permissions, permissions)
    .replace(CI_TEMPLATE_PLACEHOLDER.command, releaseCommand)
    .replace(CI_TEMPLATE_PLACEHOLDER.deploymentSetup, deploymentSetup)
    .replace(CI_TEMPLATE_PLACEHOLDER.deployment, deployment)
    .replace(CI_TEMPLATE_PLACEHOLDER.deno, deno);
  return {
    content,
    assertGithubPackagesSetupSupported: () => assertGeneratedGithubPackagesSetupSupported(repositoryRoot, config, environment, projectGithubPackages, authenticatesGithubPackages),
  };
}

/**
 * Renders a workflow that installs the project's package manager and finishes a pinned release.
 * @param {string} repositoryRoot - Project checkout.
 * @param {ResolvedCreateVersionConfig} config - Release hooks and package manager.
 * @param {{ validateGithubPackages?: boolean }} [options] - `validateGithubPackages: false` only renders,
 *   for comparisons against a committed workflow that may be customized and authenticate on its own.
 * @returns {Promise<string>} GitHub Actions YAML.
 * @throws {ReleaseStepError} When Git cannot list or read HEAD or, while validating, the GitHub Packages
 *   setup is unsupported (see {@link assertGeneratedGithubPackagesSetupSupported}).
 */
export async function renderCiReleaseWorkflow(repositoryRoot, config, { validateGithubPackages = true } = {}) {
  const workflow = await prepareCiReleaseWorkflow(repositoryRoot, config);
  if (validateGithubPackages) await workflow.assertGithubPackagesSetupSupported();
  return workflow.content;
}

/**
 * Prepares a named CI export and a new workflow without replacing existing project code.
 * Syntax is checked with Node before anything in the project is written.
 * @param {string} repositoryRoot - Checkout whose configuration is already loaded.
 * @param {ResolvedCreateVersionConfig} config - Configuration selecting the default workflow.
 * @param {boolean} [writeConfiguration] - Add a named CI export only when settings were absent.
 * @returns {Promise<ReleaseFileUpdate[]>} Files to include atomically with the bump.
 * @throws {ReleaseStepError} When an existing workflow would be overwritten or configuration cannot be extended.
 */
export async function prepareCiSetupFiles(repositoryRoot, config, writeConfiguration = true) {
  const workflowPath = ciWorkflowPath(config.ci?.workflow ?? DEFAULT_CI_WORKFLOW);
  assertSafeCiPath(repositoryRoot, workflowPath);
  if (existsSync(path.join(repositoryRoot, workflowPath))) throw new ReleaseStepError(`${workflowPath} ya existe; no se reemplazó.`, "Configurá ci.workflow en astra-rp.config.(m)js y verificá que reciba version, tag y sha y ejecute --ci-release.");
  const configFile = CREATE_VERSION_CONFIG_FILES.find((fileName) => existsSync(path.join(repositoryRoot, fileName)));
  if (!configFile || !lstatSync(path.join(repositoryRoot, configFile)).isFile()) throw new ReleaseStepError("No se pudo encontrar una configuración regular para agregar CI.", "Configurá ci.workflow manualmente en astra-rp.config.(m)js.");
  const originalBytes = readFileSync(path.join(repositoryRoot, configFile));
  const content = `${originalBytes.toString("utf8").trimEnd()}\n\n/** GitHub Actions workflow used by create-version. */\nexport const ${CI_CONFIG_EXPORT} = ${JSON.stringify(config.ci)};\n`;
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "astra-rp-ci-config-"));
  try {
    const candidate = path.join(temporaryDirectory, "config.mjs");
    writeFileSync(candidate, content);
    const checked = await runCaptured(process.execPath, ["--check", candidate]);
    if (writeConfiguration && checked.status !== 0) throw new ReleaseStepError("La configuración existente no admite el export ci automático.", "Agregá ci: { workflow: 'release.yml' } a su export default; no se cambió ningún archivo.");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  /** @type {ReleaseFileUpdate[]} */
  const updates = [
    ...(writeConfiguration ? [{ filePath: configFile, originalBytes, content }] : []),
    { filePath: workflowPath, originalBytes: null, content: await renderCiReleaseWorkflow(repositoryRoot, config) },
  ];
  if (config.ci?.deployment === CI_VERCEL_DEPLOYMENT) {
    for (const fileName of [".gitignore", CI_VERCEL_CONFIG_FILE, CI_VERCEL_GATE_FILE]) assertSafeCiPath(repositoryRoot, fileName);
    await assertVercelWorkerPathsUntracked(repositoryRoot);
    const ignored = path.join(repositoryRoot, ".gitignore");
    const originalIgnoredBytes = existsSync(ignored) ? readFileSync(ignored) : null;
    updates.push({ filePath: ".gitignore", originalBytes: originalIgnoredBytes, content: `${originalIgnoredBytes?.toString("utf8").trimEnd() ?? ""}\n.vercel/\n.env\n` });
    const vercelPath = path.join(repositoryRoot, CI_VERCEL_CONFIG_FILE);
    const originalVercelBytes = readFileSync(vercelPath);
    const vercel = JSON.parse(originalVercelBytes.toString("utf8"));
    if (vercel.ignoreCommand !== undefined && typeof vercel.ignoreCommand !== "string") throw new ReleaseStepError("vercel.json tiene un ignoreCommand que no es un comando válido.", "Corregilo antes de configurar CI; no se cambió ningún archivo.");
    if (existsSync(path.join(repositoryRoot, CI_VERCEL_GATE_FILE))) throw new ReleaseStepError(`${CI_VERCEL_GATE_FILE} ya existe; no se reemplazó.`, "Revisá la configuración de CI existente.");
    const gate = readFileSync(new URL(CI_VERCEL_GATE_TEMPLATE, import.meta.url), "utf8").replace(CI_VERCEL_IGNORE_PLACEHOLDER, () => JSON.stringify(vercel.ignoreCommand ?? null));
    updates.push({ filePath: CI_VERCEL_GATE_FILE, originalBytes: null, content: gate });
    updates.push({ filePath: CI_VERCEL_CONFIG_FILE, originalBytes: originalVercelBytes, content: `${JSON.stringify({ ...vercel, ignoreCommand: `node ${CI_VERCEL_GATE_FILE}` }, null, 2)}\n` });
  }
  if (updates.some((update) => config.versionFiles.includes(update.filePath))) throw new ReleaseStepError("Un archivo de la configuración automática de CI también figura en versionFiles.", "Quitalo de versionFiles antes de configurar CI; no se cambió nada.");
  for (const update of updates.filter((file) => file.originalBytes !== null)) {
    const literalPath = `${GIT_LITERAL_PATHSPEC_PREFIX}${update.filePath}`;
    const tracked = await runCaptured("git", ["ls-files", "--error-unmatch", "--", literalPath], { cwd: repositoryRoot });
    const clean = await runCaptured("git", ["diff", "--quiet", "HEAD", "--", literalPath], { cwd: repositoryRoot });
    if (tracked.status !== 0 || clean.status !== 0) throw new ReleaseStepError(`La configuración automática de CI necesita ${update.filePath} commiteado y limpio.`, "Commiteá esos ajustes o guardalos con git stash antes de configurar CI; --ignore-local-changes no los incluirá en el release.");
  }
  return updates;
}

/**
 * Rejects Vercel setup when the worker would overwrite tracked files after checkout: ignoring them
 * afterwards does not untrack them, so `--ci-release` would find a dirty tree on every run of the tag.
 * @param {string} repositoryRoot - Checkout about to receive the Vercel workflow.
 * @returns {Promise<void>}
 * @throws {ReleaseStepError} When a path written by `vercel pull` in the worker is tracked by Git.
 */
async function assertVercelWorkerPathsUntracked(repositoryRoot) {
  const literalPaths = CI_VERCEL_WORKER_WRITTEN_PATHS.map((filePath) => `${GIT_LITERAL_PATHSPEC_PREFIX}${filePath}`);
  const listed = await runCaptured("git", ["ls-files", "-z", "--", ...literalPaths], { cwd: repositoryRoot });
  if (listed.status !== 0) throw new ReleaseStepError(`No se pudo comprobar si ${CI_VERCEL_WORKER_WRITTEN_PATHS.join(" o ")} están versionados (git ls-files terminó con status ${listed.status}).`, "Revisá el repositorio Git antes de configurar CI; no se cambió ningún archivo.");
  const trackedPaths = listed.stdout.split("\0").filter(Boolean);
  if (trackedPaths.length > 0) throw new ReleaseStepError(`El worker de Vercel sobrescribe archivos versionados (${trackedPaths.join(", ")}); el release en CI quedaría con cambios locales y se bloquearía.`, `Quitalos del índice con git rm -r --cached -- ${trackedPaths.join(" ")} (la copia local se conserva), commiteá y volvé a configurar CI; no se cambió ningún archivo.`);
}

/**
 * Records the execution mode for the early Vercel build gate without importing project dependencies.
 * @param {string} repositoryRoot - Project root.
 * @param {string} version - Version of the release being committed.
 * @param {"local" | "ci"} execution - Execution location chosen for this release.
 * @returns {ReleaseFileUpdate} Version-scoped metadata included in the bump.
 */
export function prepareCiReleaseMetadata(repositoryRoot, version, execution) {
  assertSafeCiPath(repositoryRoot, CI_RELEASE_METADATA_FILE);
  const metadataPath = path.join(repositoryRoot, CI_RELEASE_METADATA_FILE);
  return { filePath: CI_RELEASE_METADATA_FILE, originalBytes: existsSync(metadataPath) ? readFileSync(metadataPath) : null, content: `${JSON.stringify({ version, execution })}\n` };
}

/**
 * Prevents concurrent editor changes from being overwritten after an interactive version prompt.
 * @param {string} repositoryRoot - Checkout about to receive the bump.
 * @param {ReleaseFileUpdate[]} updates - CI files captured before prompting.
 * @returns {void}
 * @throws {ReleaseStepError} When a captured file changed or a new workflow appeared.
 */
export function assertCiSetupFilesUnchanged(repositoryRoot, updates) {
  for (const update of updates) {
    assertSafeCiPath(repositoryRoot, update.filePath);
    const target = path.join(repositoryRoot, update.filePath);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (update.originalBytes === null ? current !== null : current === null || !update.originalBytes.equals(current)) throw new ReleaseStepError(`${update.filePath} cambió después de preparar la configuración de CI.`, "Conservá esos cambios y volvé a correr el comando; no se escribió el bump ni se reemplazó la configuración.");
  }
}

/**
 * Rejects symlinks anywhere in an owned setup path before writes can leave the checkout.
 * @param {string} repositoryRoot - Trusted checkout root.
 * @param {string} relativePath - Constant or validated relative file path.
 * @returns {void}
 * @throws {ReleaseStepError} When an existing path component is a symlink.
 */
export function assertSafeCiPath(repositoryRoot, relativePath) {
  let current = repositoryRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let entry;
    try { entry = lstatSync(current); } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") break;
      throw new ReleaseStepError(`No se pudo comprobar la ruta ${relativePath} para CI.`, "Revisá los permisos antes de configurar CI; no se escribió nada.", { cause: error });
    }
    if (entry.isSymbolicLink()) throw new ReleaseStepError(`${relativePath} contiene un enlace simbólico.`, "Usá archivos y directorios regulares para configurar CI; no se escribió nada.");
  }
}
