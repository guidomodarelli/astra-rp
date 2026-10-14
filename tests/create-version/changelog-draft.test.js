import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { draftChangelogEntries, parseChangelogDraft } from "../../src/create-version/changelog-draft.js";
import { loadCreateVersionConfig } from "../../src/create-version/config.js";
import { cleanupTemporaryDirectories, commitFixtureRepository, createTemporaryDirectory, runGit } from "./support/cli-harness.js";
import { FAKE_CLAUDE_QUOTA_MESSAGE, FAKE_CODEX_QUOTA_MESSAGE, installFakeAgents, isolatedAgentPath, pathVariableName } from "./support/fake-agent-cli.js";

/** Entries a fake agent answers in the tests. */
const DRAFTED_ENTRIES = "### Added\n\n- Nueva opción para redactar el CHANGELOG.\n\n### Fixed\n\n- La fecha del release respeta la zona horaria.";

/** Commits of the release the prompt is built from. */
const RELEASE_COMMITS = [
  { sha: "a1b2c3d4e5f6a7b8c9d0", subject: "feat: add gate" },
  { sha: "0f9e8d7c6b5a4f3e2d1c", subject: "fix: release date" },
];

/** Line the release adds to the tracked source, expected in the diff the agents receive. */
const RELEASED_SOURCE_LINE = "export const gate = true;";

/** Untracked local credential the agents must never see. */
const UNTRACKED_SECRET_FILE = ".npmrc";

const pathVariable = pathVariableName();
const originalPath = process.env[pathVariable];

/**
 * Puts only the fake agents (plus Node, Git and the system commands) on `PATH` for the code under test.
 *
 * @param {Parameters<typeof installFakeAgents>[0]} agents - Agents to install.
 * @returns {ReturnType<typeof installFakeAgents>} Fake agents.
 */
function useFakeAgents(agents) {
  const fakeAgents = installFakeAgents(agents);
  process.env[pathVariable] = isolatedAgentPath(fakeAgents.binDirectory);
  return fakeAgents;
}

/**
 * @param {string | null} [lastReleaseSha] - Commit of the last release.
 * @returns {import("../../src/create-version/changelog-draft.js").ChangelogDraftRequest} Release of {@link RELEASE_COMMITS}.
 */
function releaseRequest(lastReleaseSha = "1234567890abcdef") {
  return { packageName: "fixture-app", changelogPath: "CHANGELOG.md", lastReleaseSha, commits: RELEASE_COMMITS };
}

/**
 * Turns a directory into a repository with a release commit and a later one that changes the
 * tracked source and the changelog, plus an untracked credential file.
 *
 * @param {string} directory - Empty directory.
 * @returns {string} SHA of the release commit.
 */
function createRepositoryWithRelease(directory) {
  mkdirSync(path.join(directory, "src"));
  writeFileSync(path.join(directory, "AGENTS.md"), "# Reglas\n");
  writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n");
  writeFileSync(path.join(directory, "src", "gate.js"), "export const gate = false;\n");
  const releaseSha = commitFixtureRepository(directory);
  writeFileSync(path.join(directory, "src", "gate.js"), `${RELEASED_SOURCE_LINE}\n`);
  writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n");
  runGit(["commit", "--quiet", "-am", "feat: add gate"], directory);
  writeFileSync(path.join(directory, UNTRACKED_SECRET_FILE), "//registry.npmjs.org/:_authToken=fixture\n");
  return releaseSha;
}

let repositoryRoot = "";
let lastReleaseSha = "";

beforeEach(() => {
  repositoryRoot = createTemporaryDirectory("beez-rp-draft-repository-");
  lastReleaseSha = createRepositoryWithRelease(repositoryRoot);
});

afterEach(() => {
  process.env[pathVariable] = originalPath;
  cleanupTemporaryDirectories();
});

describe("changelog draft answers", () => {
  it("should accept Keep a Changelog sections, also wrapped in a Markdown fence", () => {
    expect(parseChangelogDraft(`\n${DRAFTED_ENTRIES}\n`)).toEqual({ entries: DRAFTED_ENTRIES, reason: null });
    expect(parseChangelogDraft(`\`\`\`markdown\n${DRAFTED_ENTRIES}\n\`\`\``)).toEqual({ entries: DRAFTED_ENTRIES, reason: null });
  });

  it.each([
    { answer: `## [Unreleased]\n\n${DRAFTED_ENTRIES}`, reason: "encabezados de versión" },
    { answer: `Acá están las entradas:\n\n${DRAFTED_ENTRIES}`, reason: "texto que no es una sección ni una entrada: Acá están las entradas:" },
    { answer: "### Docs\n\n- README nuevo.", reason: "secciones fuera de Keep a Changelog (Docs)" },
    { answer: "### Added\n", reason: "no tiene entradas" },
    { answer: "", reason: "la respuesta no tiene entradas" },
    { answer: `- Entrada suelta.\n\n${DRAFTED_ENTRIES}`, reason: "texto fuera de una sección ###: - Entrada suelta." },
    { answer: "### Added\n\n- Una.\n\n### Added\n\n- Otra.", reason: "repite la sección ### Added" },
    { answer: "### Fixed\n\n- Una.\n\n### Added\n\n- Otra.", reason: "la sección ### Added está fuera del orden de Keep a Changelog" },
    { answer: "### Added\n\n### Fixed\n\n- Una.", reason: "la sección ### Added no tiene entradas" },
    { answer: "### Added\n\n- Una entrada que sigue\n  en otra línea.", reason: "entrada repartida en varias líneas; cada cambio va en una sola línea" },
    { answer: `### Added\n\n- Una.\u001b]52;c;cm0gLXJmIH4=\u0007`, reason: "la respuesta incluye caracteres de control" },
  ])("should reject an answer when $reason", ({ answer, reason }) => {
    const parsed = parseChangelogDraft(answer);

    expect(parsed.entries).toBeNull();
    expect(parsed.reason).toContain(reason);
  });
});

describe("drafting with agent CLIs", () => {
  it("should ask Claude Code first, in an isolated copy of the tracked files with the release diff, and remove it afterwards", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES }, codex: { kind: "answer", text: "### Added\n\n- Otra." } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    expect(draft).toEqual({ provider: "claude", entries: DRAFTED_ENTRIES, failures: [] });
    const calls = fakeAgents.readCalls();
    expect(calls.map((call) => call.name)).toEqual(["claude"]);
    const [claudeCall] = calls;
    expect(path.relative(realpathSync(repositoryRoot), claudeCall.cwd).startsWith("..")).toBe(true);
    expect(claudeCall.files).toEqual(expect.arrayContaining(["repository/AGENTS.md", "repository/CHANGELOG.md", "repository/src/gate.js", "release-context/changes.diff", "release-context/commits.log"]));
    expect(claudeCall.files.some((file) => file.endsWith(UNTRACKED_SECRET_FILE) || file.includes(".git/"))).toBe(false);
    expect(claudeCall.diff).toContain(`+${RELEASED_SOURCE_LINE}`);
    expect(claudeCall.diff).not.toContain("CHANGELOG.md");
    expect(claudeCall.args.some((commandArgument) => path.isAbsolute(commandArgument))).toBe(false);
    expect(claudeCall.prompt).toContain(`${lastReleaseSha}..HEAD`);
    expect(claudeCall.prompt).toContain("release-context/changes.diff");
    expect(claudeCall.prompt).toContain("- a1b2c3d feat: add gate");
    expect(claudeCall.prompt).toContain("- 0f9e8d7 fix: release date");
    expect(existsSync(claudeCall.cwd)).toBe(false);
  });

  it("should fall back to Codex when Claude Code has no quota left, reporting why", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "quota" }, codex: { kind: "answer", text: DRAFTED_ENTRIES } });
    /** @type {string[]} */
    const reported = [];

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, request: releaseRequest(lastReleaseSha), onFailure: ({ provider, reason }) => reported.push(`${provider}: ${reason}`) });

    // Assert
    expect(draft.provider).toBe("codex");
    expect(draft.entries).toBe(DRAFTED_ENTRIES);
    expect(draft.failures).toEqual([{ provider: "claude", reason: `falló con código 1: ${FAKE_CLAUDE_QUOTA_MESSAGE}` }]);
    expect(reported).toEqual([`claude: falló con código 1: ${FAKE_CLAUDE_QUOTA_MESSAGE}`]);
    const codexCall = fakeAgents.readCalls().find((call) => call.name === "codex");
    expect(codexCall?.prompt).toContain("feat: add gate");
    expect(codexCall?.diff).toContain(`+${RELEASED_SOURCE_LINE}`);
    expect(codexCall?.args.some((commandArgument) => path.isAbsolute(commandArgument))).toBe(false);
  });

  it("should draft from the whole history before the first release, even from a repository whose path has cmd.exe metacharacters", async () => {
    // Arrange
    const unusualRoot = path.join(createTemporaryDirectory("beez-rp-draft-unusual-"), "repo %TEMP% ^& !x!");
    mkdirSync(unusualRoot);
    createRepositoryWithRelease(unusualRoot);
    const fakeAgents = useFakeAgents({ codex: { kind: "answer", text: DRAFTED_ENTRIES } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["codex"], repositoryRoot: unusualRoot, request: releaseRequest(null) });

    // Assert
    expect(draft).toEqual({ provider: "codex", entries: DRAFTED_ENTRIES, failures: [] });
    const [codexCall] = fakeAgents.readCalls();
    expect(codexCall.diff).toContain(`+${RELEASED_SOURCE_LINE}`);
    expect(codexCall.diff).toContain("+# Reglas");
  });

  it("should keep the files marked export-ignore in the isolated copy, without staging anything in the repository", async () => {
    // Arrange
    writeFileSync(path.join(repositoryRoot, ".gitattributes"), "AGENTS.md export-ignore\n");
    runGit(["add", ".gitattributes"], repositoryRoot);
    runGit(["commit", "--quiet", "-m", "chore: ignore rules on export"], repositoryRoot);
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    expect(draft.entries).toBe(DRAFTED_ENTRIES);
    const [claudeCall] = fakeAgents.readCalls();
    expect(claudeCall.files).toEqual(expect.arrayContaining(["repository/AGENTS.md", "repository/.gitattributes"]));
    expect(runGit(["status", "--porcelain", "--untracked-files=no"], repositoryRoot)).toBe("");
  });

  it("should show the agent the changelog of the working tree, with changes not committed yet", async () => {
    // Arrange
    const workingChangelog = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- First release.\n";
    writeFileSync(path.join(repositoryRoot, "CHANGELOG.md"), workingChangelog);
    const fakeAgents = useFakeAgents({ codex: { kind: "answer", text: DRAFTED_ENTRIES } });

    // Act
    await draftChangelogEntries({ providers: ["codex"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    const [codexCall] = fakeAgents.readCalls();
    expect(codexCall.changelog).toBe(workingChangelog);
    expect(codexCall.prompt).toContain("release-context/CHANGELOG.md");
  });

  it("should report every agent as failed, without running any, when the isolated copy cannot be created", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES }, codex: { kind: "answer", text: DRAFTED_ENTRIES } });
    const notARepository = createTemporaryDirectory("beez-rp-draft-not-a-repository-");

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot: notARepository, request: releaseRequest(null) });

    // Assert
    expect(draft.entries).toBeNull();
    expect(draft.failures.map(({ provider }) => provider)).toEqual(["claude", "codex"]);
    for (const { reason } of draft.failures) expect(reason).toContain("no se pudo preparar la copia aislada del repositorio");
    expect(fakeAgents.readCalls()).toEqual([]);
  });

  it("should try the next agent when the answer is not usable or the agent takes too long", async () => {
    // Arrange
    useFakeAgents({ claude: { kind: "sleep" }, codex: { kind: "answer", text: `Listo:\n${DRAFTED_ENTRIES}` } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, request: releaseRequest(lastReleaseSha), timeoutMs: 3_000 });

    // Assert
    expect(draft.entries).toBeNull();
    expect(draft.failures.map(({ provider }) => provider)).toEqual(["claude", "codex"]);
    expect(draft.failures[0].reason).toBe("no respondió en 3 s");
    expect(draft.failures[1].reason).toContain("texto que no es una sección ni una entrada: Listo:");
  }, 30_000);

  it("should report every failure when Claude Code is not installed and Codex has no quota left", async () => {
    // Arrange
    useFakeAgents({ codex: { kind: "quota" } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    expect(draft).toEqual({
      provider: null,
      entries: null,
      failures: [
        { provider: "claude", reason: "claude no está instalado o no está en el PATH" },
        { provider: "codex", reason: `falló con código 1: ${FAKE_CODEX_QUOTA_MESSAGE}` },
      ],
    });
  });

  it("should report an agent failure without the terminal control sequences of its message", async () => {
    // Arrange
    useFakeAgents({ codex: { kind: "fail", message: "\u001b]52;c;cm0gLXJmIH4=\u0007\u001b[31mERROR: sin cuota\u009b0m" } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["codex"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    expect(draft.failures).toEqual([{ provider: "codex", reason: "falló con código 1: ]52;c;cm0gLXJmIH4=[31mERROR: sin cuota0m" }]);
    expect(draft.failures[0].reason).not.toContain("\u001b");
  });

  it("should only try the agents the configuration lists, in its order", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES }, codex: { kind: "answer", text: DRAFTED_ENTRIES } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["codex"], repositoryRoot, request: releaseRequest(lastReleaseSha) });

    // Assert
    expect(draft.provider).toBe("codex");
    expect(fakeAgents.readCalls().map((call) => call.name)).toEqual(["codex"]);
  });
});

describe("changelogDraft configuration", () => {
  /**
   * @param {string} value - Source of the `changelogDraft` value.
   * @returns {ReturnType<typeof loadCreateVersionConfig>} Resolved configuration.
   */
  function loadWithChangelogDraft(value) {
    writeFileSync(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "fixture-app", version: "0.1.0" }));
    writeFileSync(path.join(repositoryRoot, "beez-rp.config.js"), `export default { checks: false, changelogDraft: ${value} };\n`);
    return loadCreateVersionConfig(repositoryRoot);
  }

  it.each([
    { value: "true", providers: ["claude", "codex"] },
    { value: "false", providers: [] },
    { value: '["codex", "claude"]', providers: ["codex", "claude"] },
  ])("should resolve changelogDraft: $value to $providers", async ({ value, providers }) => {
    expect((await loadWithChangelogDraft(value)).changelogDraft).toEqual(providers);
  });

  it.each(['"claude"', "[]", '["gemini"]', '["codex", "codex"]'])("should reject changelogDraft: %s", async (value) => {
    await expect(loadWithChangelogDraft(value)).rejects.toThrow("changelogDraft must be true, false or a non-empty list of distinct agents");
  });
});
