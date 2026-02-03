/**
 * Unified HTTP wrapper types.
 *
 * @module @modelcontextprotocol/ext-apps/http-adapter
 */

import type { McpHttpBaseOptions } from "./shared/http-types.js";

/**
 * Options for the unified MCP HTTP wrapper.
 */
export interface McpHttpOptions extends McpHttpBaseOptions {
  /**
   * Whether to patch the Fetch API.
   * Set to `false` to only patch XMLHttpRequest.
   * @default true
   */
  patchFetch?: boolean;

  /**
   * Whether to patch XMLHttpRequest.
   * Set to `false` to only patch the Fetch API.
   * @default true
   */
  patchXhr?: boolean;
}

/**
 * Handle returned from initMcpHttp.
 */
export interface McpHttpHandle {
  /**
   * Restores the original fetch and XMLHttpRequest implementations.
   */
  restore: () => void;
}
