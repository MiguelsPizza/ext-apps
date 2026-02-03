/**
 * JSON helpers shared across HTTP adapters.
 */

/**
 * Options for safe JSON parsing.
 */
export interface JsonParseOptions {
  context?: string;
  debug?: boolean;
}

/**
 * Safely parses JSON, returning undefined on failure.
 */
export function safeJsonParse(
  value: string,
  options: JsonParseOptions = {},
): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch (error) {
    const context = options.context ?? "JSON value";
    const detail = error instanceof Error ? error.message : String(error);
    if (options.debug) {
      console.debug(`[MCP HTTP] JSON parse failed for ${context}:`, detail);
    } else {
      console.warn(`[MCP HTTP] JSON parse failed for ${context}:`, detail);
    }
    return undefined;
  }
}
