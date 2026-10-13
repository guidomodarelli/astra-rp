/**
 * JSON helpers shared by the release modes: plain-object checks and manifest reads.
 *
 * @module create-version/json
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { PACKAGE_MANIFEST_FILE } from "../constants/create-version.js";

/**
 * Tells whether a value is a plain JSON object.
 *
 * @param {unknown} value - Any value.
 * @returns {value is Record<string, unknown>} Whether it is a non-array object.
 */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads and parses a JSON manifest from the working tree; read and parse errors propagate as they are.
 *
 * @param {string} directory - Directory the manifest path is relative to.
 * @param {string} [manifestPath] - Manifest path; the `package.json` of the directory by default.
 * @returns {any} Parsed manifest.
 * @throws {Error} When the file cannot be read or is not valid JSON.
 */
export function readJsonManifest(directory, manifestPath = PACKAGE_MANIFEST_FILE) {
  return JSON.parse(readFileSync(path.join(directory, manifestPath), "utf8"));
}
