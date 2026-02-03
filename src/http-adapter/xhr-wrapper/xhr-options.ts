/**
 * XHR wrapper options.
 */
import type { McpHttpBaseOptions } from "../http-options.js";

/**
 * Options for initializing the MCP XHR wrapper.
 */
export interface McpXhrOptions extends McpHttpBaseOptions {
  /**
   * Custom function to determine if a request should be intercepted.
   * Takes precedence over `interceptPaths` if provided.
   *
   * **Note:** Unlike {@link McpFetchOptions.shouldIntercept}, this receives raw strings
   * rather than URL/Request objects due to XHR API constraints (method and URL are
   * known at `open()` time, before headers are set).
   *
   * @param method - HTTP method (e.g., "GET", "POST")
   * @param url - Request URL string (may be relative or absolute)
   * @returns `true` to intercept and proxy through MCP, `false` for native XHR
   *
   * @example
   * ```ts
   * shouldIntercept: (method, url) => {
   *   // Only intercept POST requests to /api
   *   return method === 'POST' && url.startsWith('/api');
   * }
   * ```
   */
  shouldIntercept?: (method: string, url: string) => boolean;
}

/**
 * Handle returned from initMcpXhr for controlling the XHR wrapper lifecycle.
 *
 * ## State Machine
 *
 * ```
 * [active] --stop()--> [inactive] --start()--> [active]
 *    |                     |
 *    +-----restore()-------+-----> [terminated]
 * ```
 *
 * - **active** (initial): XHR requests matching `interceptPaths` are proxied through MCP
 * - **inactive**: All requests use native XMLHttpRequest (reversible with `start()`)
 * - **terminated**: Wrapper is permanently uninstalled (irreversible)
 *
 * @example
 * ```ts
 * const handle = initMcpXhr(app);
 *
 * // Temporarily disable interception
 * handle.stop();
 * const xhr = new XMLHttpRequest(); // Uses native XHR
 * handle.start();
 *
 * // Permanent cleanup (e.g., on unmount)
 * handle.restore(); // Cannot restart after this
 * ```
 */
export interface McpXhrHandle {
  /** The wrapped XMLHttpRequest class (can be used directly instead of global) */
  XMLHttpRequest: typeof XMLHttpRequest;
  /**
   * Pause interception. Requests will use native XHR until `start()` is called.
   * This is reversible, unlike `restore()`.
   */
  stop: () => void;
  /**
   * Resume interception after `stop()` was called.
   * Has no effect if already active or after `restore()`.
   */
  start: () => void;
  /**
   * Check if currently intercepting requests.
   * Returns `false` after `stop()` or `restore()`.
   */
  isActive: () => boolean;
  /**
   * Permanently uninstall the wrapper and restore native XMLHttpRequest.
   * **This is irreversible** - calling `start()` after `restore()` has no effect.
   * Use for cleanup when the MCP app is being unmounted.
   */
  restore: () => void;
}
