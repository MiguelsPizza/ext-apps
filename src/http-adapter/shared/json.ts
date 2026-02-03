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
    if (options.debug && options.context) {
      console.debug(
        `[MCP HTTP] JSON parse failed for ${options.context}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return undefined;
  }
}
