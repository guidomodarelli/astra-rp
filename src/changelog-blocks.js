/**
 * Internal helpers that split `CHANGELOG.md` into release blocks and rewrite the `[Unreleased]`
 * block. Shared by the public `@golfo/rp/changelog` module and by `create-version`; not part of the
 * package's public API (no `exports` entry and no reexport from `@golfo/rp`).
 *
 * @module changelog-blocks
 */

import { CHANGELOG_TITLE, RELEASE_HEADING_PATTERN, UNRELEASED_HEADING, UNRELEASED_LINE_PATTERN } from "./constants/changelog.js";

/**
 * @typedef {{ label: string, heading: string, start: number, bodyStart: number, end: number }} ChangelogBlock
 */

/**
 * Splits the changelog into release blocks in document order.
 *
 * @param {string} changelog - CHANGELOG.md contents.
 * @returns {ChangelogBlock[]} Blocks.
 */
export function listBlocks(changelog) {
  const headings = [...changelog.matchAll(RELEASE_HEADING_PATTERN)];
  return headings.map((match, index) => {
    const start = match.index ?? 0;
    return {
      label: match[1],
      heading: match[0],
      start,
      bodyStart: start + match[0].length,
      end: headings[index + 1]?.index ?? changelog.length,
    };
  });
}

/**
 * Replaces the `[Unreleased]` block with `body`, or inserts the block above the newest release.
 *
 * @param {string} changelog - Existing contents, or an empty string for a new file.
 * @param {string} body - New block body, already using `lineBreak`.
 * @param {string} lineBreak - Line break written around the body.
 * @returns {string} Changelog with the new `[Unreleased]` block.
 */
export function replaceUnreleasedBody(changelog, body, lineBreak) {
  const replacement = `${UNRELEASED_HEADING}${lineBreak}${lineBreak}${body}${lineBreak}${lineBreak}`;
  const blocks = listBlocks(changelog);
  const unreleased = blocks.find((block) => UNRELEASED_LINE_PATTERN.test(block.heading));
  if (unreleased) {
    return `${changelog.slice(0, unreleased.start)}${replacement}${changelog.slice(unreleased.end)}`;
  }
  const insertion = blocks[0]?.start ?? changelog.length;
  const prefix = changelog.slice(0, insertion).trimEnd() || CHANGELOG_TITLE;
  return `${prefix}${lineBreak}${lineBreak}${replacement}${changelog.slice(insertion)}`;
}
