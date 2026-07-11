const AUTH_SECRET = "stub-auth-secret-for-tests";

export function resolveClientIp(headers: Record<string, string>) {
  if (headers["x-forwarded-for"]) return headers["x-forwarded-for"];
  return AUTH_SECRET ? "test-mode" : "unknown";
}
