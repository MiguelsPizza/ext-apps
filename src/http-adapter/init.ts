/**
 * Unified HTTP wrapper for MCP Apps.
 *
 * Patches both `fetch()` and `XMLHttpRequest` to route HTTP requests
 * through MCP server tools.
 *
 * @module @modelcontextprotocol/ext-apps/http-adapter
 */
import type { App } from "../app.js";
import { initMcpFetch } from "./fetch-wrapper/fetch.js";
import { initMcpXhr } from "./xhr-wrapper/xhr.js";
import type { McpHttpHandle, McpHttpOptions } from "./http-options.js";

/**
 * Initialize the unified MCP HTTP wrapper.
 */
export function initMcpHttp(
  app: App,
  options: McpHttpOptions = {},
): McpHttpHandle {
  const handles: Array<{ restore: () => void }> = [];

  if (options.patchFetch !== false) {
    handles.push(initMcpFetch(app, options));
  }

  if (options.patchXhr !== false) {
    handles.push(initMcpXhr(app, options));
  }

  return {
    restore: () => {
      for (const handle of handles) {
        handle.restore();
      }
    },
  };
}
