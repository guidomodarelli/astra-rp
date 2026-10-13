/**
 * Strict UTF-8 decoding for files the release rewrites as text.
 *
 * @module create-version/strict-utf8
 */

/**
 * Strict UTF-8 decoder: invalid bytes (such as an ISO-8859-1 file) throw instead of turning into
 * U+FFFD, and a byte order mark is kept as text, so writing the text back never changes other bytes.
 */
export const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
