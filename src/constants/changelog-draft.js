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
 * Claude Code in print mode, inside the repository but read-only: it may read files and run
 * `git log`, `git diff` and `git show`; `dontAsk` denies every other tool call instead of asking,
 * whatever default mode the user's settings choose. The answer comes back as JSON.
 */
export const CLAUDE_DRAFT_ARGUMENTS = Object.freeze([
  "-p",
  "--output-format",
  "json",
  "--permission-mode",
  "dontAsk",
  "--tools",
  "Read,Grep,Glob,Bash",
  "--allowedTools",
  "Bash(git log:*),Bash(git diff:*),Bash(git show:*)",
]);

/** `--output-format json` result that reports a successful answer. */
export const CLAUDE_SUCCESS_SUBTYPE = "success";

/**
 * Codex in non-interactive mode, sandboxed read-only, without saving the session. The repository
 * root follows `--cd`, the last-message file follows `--output-last-message` and the prompt comes
 * from stdin (`-`).
 */
export const CODEX_DRAFT_ARGUMENTS = Object.freeze(["exec", "--sandbox", "read-only", "--ephemeral", "--color", "never"]);

/** Codex option that sets the repository it works in. */
export const CODEX_DIRECTORY_OPTION = "--cd";

/** Codex option that writes its last message to a file. */
export const CODEX_LAST_MESSAGE_OPTION = "--output-last-message";

/** Codex reads its prompt from stdin when the prompt argument is `-`. */
export const CODEX_STDIN_PROMPT_ARGUMENT = "-";

/** File, inside a temporary directory, where Codex writes its last message. */
export const CODEX_LAST_MESSAGE_FILE = "last-message.md";

/** Prefix of the temporary directory that holds the Codex last message, outside the repository. */
export const CHANGELOG_DRAFT_DIRECTORY_PREFIX = "beez-rp-changelog-draft-";

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

/** Windows command that resolves an executable on `PATH`, including the `.cmd` shims npm installs. */
export const WINDOWS_EXECUTABLE_LOOKUP_COMMAND = "where";

/** Files Windows can run; `where` also lists the extensionless shell script next to an npm `.cmd` shim. */
export const WINDOWS_RUNNABLE_FILE_PATTERN = /\.(?:exe|com|cmd|bat)$/iu;

/** Windows scripts that only a shell can run, such as the `claude.cmd` shim npm installs. */
export const WINDOWS_SHELL_SCRIPT_PATTERN = /\.(?:cmd|bat)$/iu;

/** Characters a Windows shell would interpret inside a double-quoted executable path. */
export const UNSAFE_SHELL_PATH_PATTERN = /["%^&|<>]/u;
