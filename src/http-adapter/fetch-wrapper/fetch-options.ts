/**
 * Fetch wrapper options.
 */
import type {
  FetchFunction,
  McpHttpBaseOptions,
  McpHttpProxyOptions,
} from "../http-options.js";

/**
 * Options for initializing the MCP fetch wrapper.
 */
export interface McpFetchOptions extends McpHttpBaseOptions {
  /**
   * Custom function to determine if a request should be intercepted.
   * Takes precedence over `interceptPaths` if provided.
   *
   * Receives rich objects (URL and Request) for full access to request details.
   *
   * @param url - Parsed URL object
   * @param request - Full Request object with headers, method, body, etc.
   * @returns `true` to intercept and proxy through MCP, `false` for native fetch
   *
   * @example
   * ```ts
   * shouldIntercept: (url, request) => {
   *   // Only intercept POST requests to /api
   *   return request.method === 'POST' && url.pathname.startsWith('/api');
   * }
   * ```
   */
  shouldIntercept?: (url: URL, request: Request) => boolean;
  /** Custom fetch function to use as the native fallback */
  fetch?: FetchFunction;
}

/**
 * Handle returned from initMcpFetch for controlling the fetch wrapper lifecycle.
 *
 * ## State Machine
 *
 * ```
 * [active] --stop()--> [inactive] --start()--> [active]
 *    |                     |
 *    +-----restore()-------+-----> [terminated]
 * ```
 *
 * - **active** (initial): Requests matching `interceptPaths` are proxied through MCP
 * - **inactive**: All requests use native fetch (reversible with `start()`)
 * - **terminated**: Wrapper is permanently uninstalled (irreversible)
 *
 * @example
 * ```ts
 * const handle = initMcpFetch(app);
 *
 * // Temporarily disable interception
 * handle.stop();
 * await fetch('/api/direct'); // Uses native fetch
 * handle.start();
 *
 * // Permanent cleanup (e.g., on unmount)
 * handle.restore(); // Cannot restart after this
 * ```
 */
export interface McpFetchHandle {
  /** The wrapped fetch function (can be used directly instead of global) */
  fetch: FetchFunction;
  /**
   * Pause interception. Requests will use native fetch until `start()` is called.
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
   * Permanently uninstall the wrapper and restore native fetch.
   * **This is irreversible** - calling `start()` after `restore()` has no effect.
   * Use for cleanup when the MCP app is being unmounted.
   */
  restore: () => void;
}

/**
 * Options for the fetch proxy handler (server-side).
 */
export type McpFetchProxyOptions = McpHttpProxyOptions;
