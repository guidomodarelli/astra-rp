/**
 * Verifies manually maintained changelogs and closes their `[Unreleased]` section in the release
 * commit: the entries are written by hand (or drafted with `changelogDraft`), the version heading
 * and its date by the release.
 *
 * @module create-version/changelog
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { readUnreleased } from "../changelog.js";
import { replaceUnreleasedBody } from "../changelog-blocks.js";
import {
  CRLF_LINE_BREAK,
  LF_LINE_BREAK,
  LINE_BREAK_PATTERN,
  SECTION_HEADING_PATTERN,
  RELEASE_DATE_FORMAT_OPTIONS,
  RELEASE_DATE_LOCALE,
  RELEASE_DATE_PAD,
  RELEASE_DATE_PART_LENGTH,
  RELEASE_DATE_PART_ORDER,
  RELEASE_DATE_SEPARATOR,
  UNRELEASED_HEADING,
  UNRELEASED_LINE_PATTERN,
} from "../constants/changelog.js";
import { ReleaseStepError, describeError } from "./errors.js";
import { STRICT_UTF8_DECODER } from "./strict-utf8.js";

/**
 * @typedef {{ updated: boolean, reason: string | null }} ChangelogUpdateState
 * @typedef {{ filePath: string, originalBytes: Buffer }} PreservedReleaseFile
 * @typedef {{ repositoryRoot: string, reader: import("./process.js").GitReader, commands: import("../package-manager.js").ProjectCommands }} ChangelogContext
 * @typedef {{ exists: boolean, entryCount: number }} UnreleasedEntriesState
 */

/**
 * Compares a changelog with its last release using Git's normalized blob hashes. Local edits,
 * staged edits and committed edits all count; an initial release requires an existing file.
 *
 * @param {import("./process.js").GitReader} reader - Read-only Git adapter.
 * @param {string} repositoryRoot - Repository root.
 * @param {string} filePath - Changelog path relative to the repository root.
 * @param {string | null} releaseRevision - Last release commit, or `null` for an initial release.
 * @returns {Promise<ChangelogUpdateState>} Whether the file was updated, or why publication must stop.
 */
export async function readChangelogUpdateState(reader, repositoryRoot, filePath, releaseRevision) {
  const absolutePath = path.join(repositoryRoot, filePath);

  try {
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      return { updated: false, reason: `${filePath} no existe como archivo regular.` };
    }

    if (!releaseRevision) {
      return { updated: true, reason: null };
    }

    const previousBlob = await reader.tryGit(["rev-parse", "--verify", `${releaseRevision}:${filePath}`]);
    const currentBlob = await reader.git(["hash-object", `--path=${filePath}`, "--", filePath]);
    return currentBlob !== previousBlob
      ? { updated: true, reason: null }
      : { updated: false, reason: `${filePath} no fue actualizado desde el último release (${releaseRevision}).` };
  } catch (error) {
    return { updated: false, reason: `No se pudo verificar ${filePath}: ${describeError(error)}.` };
  }
}

/**
 * Explains why a changelog cannot be closed in the release commit: it has no `## [Unreleased]`
 * block, or that block has no entry (`- ` line) to release.
 *
 * @param {UnreleasedEntriesState} unreleased - `[Unreleased]` block of the changelog.
 * @param {string} filePath - Changelog path relative to the repository root.
 * @returns {string | null} Reason in Spanish, or `null` when the block has entries.
 */
export function describeMissingUnreleasedEntries(unreleased, filePath) {
  if (!unreleased.exists) return `${filePath} no tiene una sección ${UNRELEASED_HEADING}`;
  return unreleased.entryCount === 0 ? `La sección ${UNRELEASED_HEADING} de ${filePath} no tiene entradas` : null;
}

/**
 * Tells whether `[Unreleased]` holds nothing an agent draft would discard: only blank lines and
 * `### <change type>` headings. Comments, release instructions or template text written there by
 * the user (maybe not committed yet) keep the block from being drafted.
 *
 * @param {import("../changelog.js").UnreleasedState} unreleased - `[Unreleased]` block of the changelog.
 * @returns {boolean} Whether drafted entries can replace the block body.
 */
export function hasOnlyEmptySections(unreleased) {
  return unreleased.entryCount === 0 && unreleased.unknownSections.length === 0 && unreleased.body.replace(SECTION_HEADING_PATTERN, "").trim() === "";
}

/**
 * Writes drafted entries as the body of `[Unreleased]`, replacing what the block held (an empty
 * block, or empty section headings; see {@link hasOnlyEmptySections}). Creates the block, or the
 * document, when missing, keeps the released history and uses the line breaks of a CRLF changelog.
 *
 * @param {string} changelog - Existing contents, or an empty string for a new file.
 * @param {string} entries - `### Section` headings and `- ` entries, without the `## [Unreleased]` heading.
 * @returns {string} Changelog whose `[Unreleased]` block holds `entries`.
 */
export function fillUnreleasedEntries(changelog, entries) {
  const lineBreak = changelog.includes(CRLF_LINE_BREAK) ? CRLF_LINE_BREAK : LF_LINE_BREAK;
  return replaceUnreleasedBody(changelog, entries.trim().split(LINE_BREAK_PATTERN).join(lineBreak), lineBreak);
}

/**
 * Says how to fix a changelog the release cannot close, without touching the version.
 *
 * @param {string} filePath - Changelog path relative to the repository root.
 * @param {string} createVersionCommand - Project command that runs `create-version`.
 * @returns {string} Actionable hint in Spanish.
 */
export function describeUnreleasedEntriesHint(filePath, createVersionCommand) {
  return `Agregá las entradas del release (líneas "- …") bajo ${UNRELEASED_HEADING} en ${filePath}, sin versión ni fecha, y volvé a correr ${createVersionCommand}; beez-rp renombra esa sección a ## [X.Y.Z] - AAAA-MM-DD en el commit de versión.`;
}

/**
 * Requires a manual changelog update and captures its bytes, so the release can tell whether a
 * later step changed them before closing `[Unreleased]`.
 *
 * @param {ChangelogContext} context - Release context.
 * @param {string} filePath - Changelog path relative to the repository root.
 * @param {string | null} releaseRevision - Last release commit, or `null` for an initial release.
 * @returns {Promise<PreservedReleaseFile>} Changelog and its bytes before the release steps.
 * @throws {ReleaseStepError} When the changelog is missing, unchanged or cannot be read.
 */
export async function verifyChangelogUpdate(context, filePath, releaseRevision) {
  const update = await readChangelogUpdateState(context.reader, context.repositoryRoot, filePath, releaseRevision);
  const hint = `Actualizá ${filePath} manualmente y volvé a correr ${context.commands.createVersion}; no se tocó la versión.`;

  if (!update.updated) {
    throw new ReleaseStepError(update.reason ?? `${filePath} no fue actualizado.`, hint);
  }

  try {
    return { filePath, originalBytes: readFileSync(path.join(context.repositoryRoot, filePath)) };
  } catch (error) {
    throw new ReleaseStepError(`No se pudo leer ${filePath} para verificar el release.`, hint, { cause: error });
  }
}

/**
 * Decodes a verified changelog as strict UTF-8: closing `[Unreleased]` over text decoded from other
 * bytes (such as ISO-8859-1) would write U+FFFD in their place in the release commit.
 *
 * @param {ChangelogContext} context - Release context.
 * @param {PreservedReleaseFile} changelog - Changelog captured by {@link verifyChangelogUpdate}.
 * @returns {string} Changelog text.
 * @throws {ReleaseStepError} When the changelog is not valid UTF-8.
 */
function decodeChangelog(context, changelog) {
  try {
    return STRICT_UTF8_DECODER.decode(changelog.originalBytes);
  } catch (error) {
    throw new ReleaseStepError(
      `${changelog.filePath} no es texto UTF-8 válido: cerrar su sección ${UNRELEASED_HEADING} cambiaría también otros bytes.`,
      `Convertilo a UTF-8 y commitealo, y volvé a correr ${context.commands.createVersion}; no se tocó la versión.`,
      { cause: error }
    );
  }
}

/**
 * Requires entries in the `[Unreleased]` block of a verified changelog, which the release commit closes.
 *
 * @param {ChangelogContext} context - Release context.
 * @param {PreservedReleaseFile} changelog - Changelog captured by {@link verifyChangelogUpdate}.
 * @returns {string} Changelog text, decoded as strict UTF-8.
 * @throws {ReleaseStepError} When the changelog is not valid UTF-8, or `[Unreleased]` is missing or has no entries.
 */
export function assertUnreleasedEntries(context, changelog) {
  const text = decodeChangelog(context, changelog);
  const reason = describeMissingUnreleasedEntries(readUnreleased(text), changelog.filePath);
  if (reason) {
    throw new ReleaseStepError(`${reason}.`, describeUnreleasedEntriesHint(changelog.filePath, context.commands.createVersion));
  }
  return text;
}

/**
 * Stops when a check or hook changed a changelog after the release captured it: closing
 * `[Unreleased]` over those bytes would ship content the release never verified.
 *
 * @param {ChangelogContext} context - Release context.
 * @param {readonly PreservedReleaseFile[]} files - Files captured before running release steps.
 * @returns {void}
 * @throws {ReleaseStepError} When a file changed, disappeared or cannot be read.
 */
export function assertPreservedFilesUnchanged(context, files) {
  for (const { filePath, originalBytes } of files) {
    let unchanged;
    try {
      const absolutePath = path.join(context.repositoryRoot, filePath);
      unchanged = lstatSync(absolutePath).isFile() && readFileSync(absolutePath).equals(originalBytes);
    } catch (error) {
      throw new ReleaseStepError(`Un paso anterior impide verificar ${filePath}.`, `Revisá el check o hook y volvé a correr ${context.commands.createVersion}.`, { cause: error });
    }
    if (!unchanged) {
      throw new ReleaseStepError(`Un paso anterior modificó ${filePath}.`, `Revisá el check o hook y volvé a correr ${context.commands.createVersion}.`);
    }
  }
}

/**
 * Formats a date as the `YYYY-MM-DD` day Keep a Changelog gives a version: the day in `timeZone`
 * when the project configures `releaseTimeZone`, so a release prepared on a CI runner in UTC keeps
 * the team's day, or the machine's local day otherwise.
 *
 * @param {Date} [date] - Moment to format; the current time by default.
 * @param {string | null} [timeZone] - IANA time zone already validated by the configuration, or `null` for the local day.
 * @returns {string} Release day in `YYYY-MM-DD` format.
 */
export function formatReleaseDate(date = new Date(), timeZone = null) {
  if (timeZone === null) {
    const month = String(date.getMonth() + 1).padStart(RELEASE_DATE_PART_LENGTH, RELEASE_DATE_PAD);
    const day = String(date.getDate()).padStart(RELEASE_DATE_PART_LENGTH, RELEASE_DATE_PAD);
    return [String(date.getFullYear()), month, day].join(RELEASE_DATE_SEPARATOR);
  }

  const parts = new Intl.DateTimeFormat(RELEASE_DATE_LOCALE, { ...RELEASE_DATE_FORMAT_OPTIONS, timeZone }).formatToParts(date);
  return RELEASE_DATE_PART_ORDER.map((partType) => parts.find((part) => part.type === partType)?.value ?? "").join(RELEASE_DATE_SEPARATOR);
}

/**
 * Closes the `[Unreleased]` section: its heading becomes `## [version] - releaseDate`, keeping its
 * body, and a new empty `## [Unreleased]` goes on top. Every other byte is kept, including the
 * line breaks of a CRLF changelog and section names outside Keep a Changelog.
 *
 * @param {string} changelog - Changelog contents.
 * @param {string} version - Version being released.
 * @param {string} releaseDate - Release day in `YYYY-MM-DD` format.
 * @returns {string} Changelog with the section closed.
 * @throws {Error} When the changelog has no `[Unreleased]` heading or that block has no entries.
 */
export function closeUnreleasedSection(changelog, version, releaseDate) {
  const reason = describeMissingUnreleasedEntries(readUnreleased(changelog), "CHANGELOG");
  if (reason) throw new Error(`create-version: ${reason}`);
  const lineBreak = changelog.includes(CRLF_LINE_BREAK) ? CRLF_LINE_BREAK : LF_LINE_BREAK;
  return changelog.replace(UNRELEASED_LINE_PATTERN, `${UNRELEASED_HEADING}${lineBreak}${lineBreak}## [${version}] - ${releaseDate}`);
}

/**
 * Prepares the release-commit update of a verified changelog: checks that no step changed it since
 * it was captured and closes its `[Unreleased]` section for `version`.
 *
 * @param {ChangelogContext} context - Release context.
 * @param {PreservedReleaseFile} changelog - Changelog captured by {@link verifyChangelogUpdate}.
 * @param {string} version - Version being released.
 * @param {string} releaseDate - Release day in `YYYY-MM-DD` format.
 * @returns {import("./run.js").ReleaseFileUpdate} File to write, with its bytes before the release.
 * @throws {ReleaseStepError} When a step changed the changelog, it is not valid UTF-8 or `[Unreleased]` cannot be closed.
 */
export function prepareChangelogClosing(context, changelog, version, releaseDate) {
  assertPreservedFilesUnchanged(context, [changelog]);
  const text = assertUnreleasedEntries(context, changelog);
  return {
    filePath: changelog.filePath,
    originalBytes: changelog.originalBytes,
    content: closeUnreleasedSection(text, version, releaseDate),
  };
}
