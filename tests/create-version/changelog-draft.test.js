import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildChangelogDraftPrompt, draftChangelogEntries, parseChangelogDraft } from "../../src/create-version/changelog-draft.js";
import { loadCreateVersionConfig } from "../../src/create-version/config.js";
import { cleanupTemporaryDirectories, createTemporaryDirectory } from "./support/cli-harness.js";
import { FAKE_CLAUDE_QUOTA_MESSAGE, FAKE_CODEX_QUOTA_MESSAGE, installFakeAgents, isolatedAgentPath, pathVariableName } from "./support/fake-agent-cli.js";

/** Entries a fake agent answers in the tests. */
const DRAFTED_ENTRIES = "### Added\n\n- Nueva opción para redactar el CHANGELOG.\n\n### Fixed\n\n- La fecha del release respeta la zona horaria.";

/** Commits of the release the prompt is built from. */
const RELEASE_COMMITS = [
  { sha: "a1b2c3d4e5f6a7b8c9d0", subject: "feat: add gate" },
  { sha: "0f9e8d7c6b5a4f3e2d1c", subject: "fix: release date" },
];

const pathVariable = pathVariableName();
const originalPath = process.env[pathVariable];

/**
 * Puts only the fake agents (plus Node and the system commands) on `PATH` for the code under test.
 *
 * @param {Parameters<typeof installFakeAgents>[0]} agents - Agents to install.
 * @returns {ReturnType<typeof installFakeAgents>} Fake agents.
 */
function useFakeAgents(agents) {
  const fakeAgents = installFakeAgents(agents);
  process.env[pathVariable] = isolatedAgentPath(fakeAgents.binDirectory);
  return fakeAgents;
}

/** @returns {string} Prompt for {@link RELEASE_COMMITS}. */
function releasePrompt() {
  return buildChangelogDraftPrompt({ packageName: "fixture-app", changelogPath: "CHANGELOG.md", lastReleaseSha: "1234567890abcdef", commits: RELEASE_COMMITS });
}

let repositoryRoot = "";

beforeEach(() => {
  repositoryRoot = createTemporaryDirectory("beez-rp-draft-repository-");
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
  ])("should reject an answer that $reason", ({ answer, reason }) => {
    const parsed = parseChangelogDraft(answer);

    expect(parsed.entries).toBeNull();
    expect(parsed.reason).toContain(reason);
  });
});

describe("drafting with agent CLIs", () => {
  it("should ask Claude Code first, inside the repository, with the release range and its commits", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES }, codex: { kind: "answer", text: "### Added\n\n- Otra." } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, prompt: releasePrompt() });

    // Assert
    expect(draft).toEqual({ provider: "claude", entries: DRAFTED_ENTRIES, failures: [] });
    const calls = fakeAgents.readCalls();
    expect(calls.map((call) => call.name)).toEqual(["claude"]);
    expect(realpathSync(calls[0].cwd)).toBe(realpathSync(repositoryRoot));
    expect(calls[0].prompt).toContain("1234567890abcdef..HEAD");
    expect(calls[0].prompt).toContain("- a1b2c3d feat: add gate");
    expect(calls[0].prompt).toContain("- 0f9e8d7 fix: release date");
  });

  it("should fall back to Codex when Claude Code has no quota left, reporting why", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "quota" }, codex: { kind: "answer", text: DRAFTED_ENTRIES } });
    /** @type {string[]} */
    const reported = [];

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, prompt: releasePrompt(), onFailure: ({ provider, reason }) => reported.push(`${provider}: ${reason}`) });

    // Assert
    expect(draft.provider).toBe("codex");
    expect(draft.entries).toBe(DRAFTED_ENTRIES);
    expect(draft.failures).toEqual([{ provider: "claude", reason: `falló con código 1: ${FAKE_CLAUDE_QUOTA_MESSAGE}` }]);
    expect(reported).toEqual([`claude: falló con código 1: ${FAKE_CLAUDE_QUOTA_MESSAGE}`]);
    const codexCall = fakeAgents.readCalls().find((call) => call.name === "codex");
    expect(codexCall?.prompt).toContain("feat: add gate");
  });

  it("should try the next agent when the answer is not usable or the agent takes too long", async () => {
    // Arrange
    useFakeAgents({ claude: { kind: "sleep" }, codex: { kind: "answer", text: `Listo:\n${DRAFTED_ENTRIES}` } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, prompt: releasePrompt(), timeoutMs: 3_000 });

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
    const draft = await draftChangelogEntries({ providers: ["claude", "codex"], repositoryRoot, prompt: releasePrompt() });

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

  it("should only try the agents the configuration lists, in its order", async () => {
    // Arrange
    const fakeAgents = useFakeAgents({ claude: { kind: "answer", text: DRAFTED_ENTRIES }, codex: { kind: "answer", text: DRAFTED_ENTRIES } });

    // Act
    const draft = await draftChangelogEntries({ providers: ["codex"], repositoryRoot, prompt: releasePrompt() });

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
