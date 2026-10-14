/**
 * Contract of the `[Unreleased]` entries `create-version` drafts with an agent CLI (Claude Code or
 * Codex) when `changelogDraft` is configured and the release would stop for a missing changelog.
 *
 * @module constants/changelog-draft
 */

/** Configuration field that turns on the drafting and orders the agent CLIs it tries. */
export const CHANGELOG_DRAFT_FIELD = "changelogDraft";

/** Agent CLIs that can draft the entries. */
export const CHANGELOG_DRAFT_PROVIDER = Object.freeze({ claude: "claude", codex: "codex" });

/** Order tried with `changelogDraft: true`: Claude Code first, Codex when Claude Code fails or has no quota left. */
export const DEFAULT_CHANGELOG_DRAFT_PROVIDERS = Object.freeze([CHANGELOG_DRAFT_PROVIDER.claude, CHANGELOG_DRAFT_PROVIDER.codex]);

/** Names printed for each agent CLI. */
export const CHANGELOG_DRAFT_PROVIDER_LABELS = Object.freeze({ [CHANGELOG_DRAFT_PROVIDER.claude]: "Claude Code", [CHANGELOG_DRAFT_PROVIDER.codex]: "Codex" });

/** Executable of each agent CLI, resolved from `PATH`. */
export const CHANGELOG_DRAFT_EXECUTABLES = Object.freeze({ [CHANGELOG_DRAFT_PROVIDER.claude]: "claude", [CHANGELOG_DRAFT_PROVIDER.codex]: "codex" });

/**
 * Prefix of the isolated workspace the agents run in: a temporary directory outside the repository,
 * removed when the drafting ends.
 */
export const CHANGELOG_DRAFT_DIRECTORY_PREFIX = "beez-rp-changelog-draft-";

/**
 * Directory of the workspace with the files Git tracks at `HEAD` (from `git archive`): no `.git`,
 * no untracked or ignored files, so local credentials such as an untracked `.env` or `.npmrc` stay
 * out of the agents' reach.
 */
export const CHANGELOG_DRAFT_SNAPSHOT_DIRECTORY = "repository";

/** Directory of the workspace with the release context beez-rp writes for the agents. */
export const CHANGELOG_DRAFT_CONTEXT_DIRECTORY = "release-context";

/** Release context file with the diff of the release range, without the changelog itself. */
export const CHANGELOG_DRAFT_DIFF_FILE = "changes.diff";

/** Release context file with the `git log --stat` of the release range. */
export const CHANGELOG_DRAFT_LOG_FILE = "commits.log";

/** Temporary `git archive` output, inside the workspace, removed once extracted. */
export const CHANGELOG_DRAFT_ARCHIVE_FILE = "snapshot.tar";

/** `rmSync` retries when removing the workspace, while Windows releases the files of a stopped agent. */
export const WORKSPACE_REMOVAL_RETRIES = Object.freeze({ maxRetries: 10, retryDelay: 100 });

/** Executable that extracts the snapshot (bsdtar ships with Windows 10 and later; GNU or BSD tar elsewhere). */
export const TAR_EXECUTABLE = "tar";

/**
 * Settings file, at the workspace root, that Claude Code loads with `--settings`: its file tools
 * refuse reads outside the working directory in every permission mode, even when the user's own
 * settings allow them.
 */
export const CLAUDE_DRAFT_SETTINGS_FILE = "claude-settings.json";

/** Contents of {@link CLAUDE_DRAFT_SETTINGS_FILE}. */
export const CLAUDE_DRAFT_SETTINGS = Object.freeze({ permissions: Object.freeze({ blockReadsOutsideWorkingDirectories: true }) });

/**
 * Claude Code in print mode, inside the isolated workspace, with only its file tools (`Read`,
 * `Grep`, `Glob`): no Bash, so no command can write files, and `--strict-mcp-config` without
 * `--mcp-config` loads no MCP server. Reads inside the working directory need no approval; reads
 * outside it need one, which `dontAsk` denies instead of asking (Claude Code documentation,
 * "Configure permissions"), and {@link CLAUDE_DRAFT_SETTINGS_FILE} also refuses them. Every
 * argument is fixed, so a Windows `.cmd` shim receives no variable path on its command line. The
 * answer comes back as JSON.
 */
export const CLAUDE_DRAFT_ARGUMENTS = Object.freeze([
  "-p",
  "--output-format",
  "json",
  "--permission-mode",
  "dontAsk",
  "--tools",
  "Read,Grep,Glob",
  "--strict-mcp-config",
  "--settings",
  CLAUDE_DRAFT_SETTINGS_FILE,
]);

/** `--output-format json` result that reports a successful answer. */
export const CLAUDE_SUCCESS_SUBTYPE = "success";

/** File, at the workspace root, where Codex writes its last message (relative to its working directory). */
export const CODEX_LAST_MESSAGE_FILE = "last-message.md";

/**
 * Codex in non-interactive mode inside the isolated workspace (its working directory, which is not
 * a Git repository), sandboxed read-only, without saving the session. Its last message goes to
 * {@link CODEX_LAST_MESSAGE_FILE} and the prompt comes from stdin (`-`). Every argument is fixed,
 * so a Windows `.cmd` shim receives no variable path on its command line.
 *
 * Residual risk: Codex 0.162 documents no option that limits reads to one directory or turns off
 * its shell tool, and `read-only` blocks writes but not reads. The workspace keeps the repository's
 * untracked credentials away, yet Codex could still read other files of the host.
 */
export const CODEX_DRAFT_ARGUMENTS = Object.freeze([
  "exec",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--ephemeral",
  "--color",
  "never",
  "--output-last-message",
  CODEX_LAST_MESSAGE_FILE,
  "-",
]);

/** Time an agent CLI has to explore the repository and answer before the next one is tried. */
export const CHANGELOG_DRAFT_TIMEOUT_MS = 600_000;

/** Characters of an agent failure shown to the user. */
export const CHANGELOG_DRAFT_MAX_FAILURE_CHARACTERS = 300;

/** Markdown code fence an agent may wrap its answer in. */
export const MARKDOWN_FENCE_PATTERN = /^```[^\n]*\n([\s\S]*?)\n```$/u;

/** A line a draft may hold: blank, a `### Section` heading, a `- ` entry or an indented continuation. */
export const CHANGELOG_DRAFT_LINE_PATTERN = /^(?:\s*|### +\S.*|\s*- +\S.*|\s+\S.*)$/u;

/** A level-2 heading such as `## [Unreleased]` or `## [1.2.0] - 2026-01-01`, which the draft must not contain. */
export const RELEASE_LEVEL_HEADING_PATTERN = /^##(?!#)/mu;

/** A single `### Section` line of a draft, capturing the section name. */
export const CHANGELOG_DRAFT_SECTION_PATTERN = /^### +(.+?)\s*$/u;

/** A blank line of a draft. */
export const BLANK_LINE_PATTERN = /^\s*$/u;

/** Windows command that resolves an executable on `PATH`, including the `.cmd` shims npm installs. */
export const WINDOWS_EXECUTABLE_LOOKUP_COMMAND = "where";

/** Files Windows can run; `where` also lists the extensionless shell script next to an npm `.cmd` shim. */
export const WINDOWS_RUNNABLE_FILE_PATTERN = /\.(?:exe|com|cmd|bat)$/iu;

/** Windows scripts that only a shell can run, such as the `claude.cmd` shim npm installs. */
export const WINDOWS_SHELL_SCRIPT_PATTERN = /\.(?:cmd|bat)$/iu;

/**
 * Characters `cmd.exe` would interpret inside a double-quoted argument: `"` ends the quotes, `%`
 * and `!` (with delayed expansion) expand variables, and `^&|<>` are its operators. The shim path
 * and every agent argument on a Windows shell command line are checked against it.
 */
export const UNSAFE_SHELL_ARGUMENT_PATTERN = /["%!^&|<>]/u;
