// Structured logging with request IDs and sanitized output — MOO-67 Commit 5.
import { randomUUID } from 'node:crypto';

const SENSITIVE_KEY_PATTERN = /token|authorization|secret|password|api[_-]?key|cookie/i;

function sanitize(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return out;
}

/** One JSON object per line to stdout (or stderr for errors) — Railway-friendly. */
export function log(level, message, meta) {
  const entry = { time: new Date().toISOString(), level, message, ...sanitize(meta) };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export function generateRequestId() {
  return randomUUID();
}

/** A logger bound to one request ID, so every log line from that request carries it. */
export function createRequestLogger(requestId) {
  return {
    info: (message, meta) => log('info', message, { requestId, ...meta }),
    warn: (message, meta) => log('warn', message, { requestId, ...meta }),
    error: (message, meta) => log('error', message, { requestId, ...meta }),
  };
}
