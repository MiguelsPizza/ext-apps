/**
 * Fetch wrapper options.
 */
import type {
  FetchFunction,
  McpHttpBaseOptions,
  McpHttpProxyOptions,
} from "../shared/http-types.js";

/**
 * Options for initializing the MCP fetch wrapper.
 */
export interface McpFetchOptions extends McpHttpBaseOptions {
  shouldIntercept?: (url: URL, request: Request) => boolean;
  fetch?: FetchFunction;
}

/**
 * Handle returned from initMcpFetch.
 */
export interface McpFetchHandle {
  fetch: FetchFunction;
  restore: () => void;
}

/**
 * Options for the fetch proxy handler (server-side).
 */
export type McpFetchProxyOptions = McpHttpProxyOptions;
