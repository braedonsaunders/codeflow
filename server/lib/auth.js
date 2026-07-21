// Private-use authentication gate — MOO-67 Commit 6.
//
// A shared-secret check (Authorization: Bearer <AUTH_TOKEN>), not a full
// multi-user login system — this is a private tool for one operator that
// happens to be publicly addressable (Railway gives it a public URL), not
// a multi-tenant service. Timing-safe comparison so a valid token can't be
// brute-forced faster via response-time side channels.
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // timingSafeEqual requires equal-length buffers; comparing against a
    // dummy of the right length keeps this branch's timing close to the
    // equal-length path instead of returning immediately.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** @returns {string|null} the bearer token, or null if the header is missing/malformed */
export function extractBearerToken(req) {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

/** @param {{authToken: string}} config */
export function isAuthorized(req, config) {
  const token = extractBearerToken(req);
  if (!token) return false;
  return safeEqual(token, config.authToken);
}
