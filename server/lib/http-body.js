// Shared bounded JSON request-body reader — MOO-67 Commit 6 (PR review fixup).
//
// Both /api/analyze and /api/analyze-repo are publicly addressable behind
// the same bearer-token gate, but only analyze-repo bounded its body size
// (via MAX_REQUEST_BODY_BYTES) -- analyze buffered the whole request
// unbounded. One shared reader instead of two subtly different parsers.
export class BodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Request body exceeds the configured limit of ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<object>} the parsed JSON body, or {} for an empty body
 * @throws {BodyTooLargeError} if the body exceeds maxBytes
 * @throws {SyntaxError} if the body is non-empty and not valid JSON
 */
export async function readJsonBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}
