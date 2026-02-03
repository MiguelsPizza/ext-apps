/**
 * Shared constants for HTTP adapters.
 */

export const DEFAULT_TOOL_NAME = "http_request";
export const DEFAULT_INTERCEPT_PATHS = ["/"];
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Headers that should be stripped from proxied requests.
 * These could be used to exfiltrate credentials or spoof identity.
 */
export const FORBIDDEN_REQUEST_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "host",
  "origin",
  "referer",
]);
