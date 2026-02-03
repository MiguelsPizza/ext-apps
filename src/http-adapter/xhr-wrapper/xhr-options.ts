/**
 * XHR wrapper options.
 */
import type { McpHttpBaseOptions } from "../shared/http-types.js";

/**
 * Options for initializing the MCP XHR wrapper.
 */
export interface McpXhrOptions extends McpHttpBaseOptions {
  /**
   * Custom function to determine if a request should be intercepted.
   * Takes precedence over interceptPaths if provided.
   */
  shouldIntercept?: (method: string, url: string) => boolean;
}

/**
 * Handle returned from initMcpXhr.
 */
export interface McpXhrHandle {
  XMLHttpRequest: typeof XMLHttpRequest;
  restore: () => void;
}
