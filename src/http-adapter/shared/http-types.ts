/**
 * Shared types for HTTP adapters.
 */

/**
 * Body encoding type for MCP HTTP requests/responses.
 */
export type McpBodyType =
  | "none"
  | "json"
  | "text"
  | "formData"
  | "urlEncoded"
  | "base64";

/**
 * Form field for multipart/form-data requests.
 */
export interface McpFormField {
  name: string;
  value?: string;
  data?: string;
  filename?: string;
  contentType?: string;
}

/**
 * HTTP request payload for MCP tool calls.
 */
export interface McpHttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpBodyType;
  redirect?: RequestRedirect;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  /** Index signature for MCP SDK compatibility */
  [key: string]: unknown;
}

/**
 * HTTP response payload from MCP tool calls.
 */
export interface McpHttpResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpBodyType;
  url?: string;
  redirected?: boolean;
  ok?: boolean;
  /** Index signature for MCP SDK compatibility */
  [key: string]: unknown;
}

/**
 * Standard fetch function signature compatible across environments.
 */
export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Base options shared by fetch and XHR wrappers.
 */
export interface McpHttpBaseOptions {
  /**
   * Name of the MCP tool to call for HTTP requests.
   * @default "http_request"
   */
  toolName?: string;

  /**
   * URL path prefixes to intercept.
   * Only requests matching these prefixes will be proxied through MCP.
   * @default ["/"]
   */
  interceptPaths?: string[];

  /**
   * Whether to allow absolute URLs (different origins) to be proxied.
   * @default false
   */
  allowAbsoluteUrls?: boolean;

  /**
   * Whether to fall back to native implementations when not connected to MCP host.
   * @default true
   */
  fallbackToNative?: boolean;

  /**
   * Default timeout in milliseconds for requests.
   */
  timeoutMs?: number;

  /**
   * Custom function to check if running in MCP app context.
   * If not provided, checks app.getHostCapabilities()?.serverTools.
   */
  isMcpApp?: () => boolean;

  /**
   * Whether to install the wrapper globally.
   * @default true
   */
  installGlobal?: boolean;
}

/**
 * Options for the HTTP proxy tool handler (server-side).
 */
export interface McpHttpProxyOptions {
  toolName?: string;
  allowOrigins?: string[];
  allowPaths?: string[];
  baseUrl?: string;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  fetch?: FetchFunction;
  headers?:
    | Record<string, string>
    | ((request: McpHttpRequest) => Record<string, string>);
  forbiddenHeaders?: Set<string>;
  maxBodySize?: number;
}
