/**
 * JSON helpers shared across HTTP adapters.
 */

/**
 * Safely parses JSON, returning undefined on failure.
 */
export function safeJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
