/**
 * Response helpers shared across HTTP adapters.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpHttpResponse } from "./http-types.js";
import { safeJsonParse } from "./json.js";

/**
 * Extracts text content from a CallToolResult.
 */
export function extractTextContent(result: CallToolResult): string | undefined {
  const blocks = (
    result as { content?: Array<{ type: string; text?: string }> }
  ).content;
  if (!blocks) {
    return undefined;
  }
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return undefined;
}

/**
 * Extracts error message from a CallToolResult.
 */
export function extractToolError(result: CallToolResult): string {
  return extractTextContent(result) ?? "MCP tool returned an error";
}

/**
 * Extracts McpHttpResponse from a CallToolResult.
 */
export function extractResponsePayload(
  result: CallToolResult,
): McpHttpResponse {
  const structured = (result as { structuredContent?: unknown })
    .structuredContent;
  if (structured && typeof structured === "object") {
    return structured as McpHttpResponse;
  }

  const text = extractTextContent(result);
  if (text) {
    const parsed = safeJsonParse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as McpHttpResponse;
    }
  }

  throw new Error("http_request did not return structured content");
}
