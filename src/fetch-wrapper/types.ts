export type McpFetchBodyType =
  | "none"
  | "json"
  | "text"
  | "formData"
  | "urlEncoded"
  | "base64";

export interface McpFetchFormField {
  name: string;
  value?: string;
  data?: string;
  filename?: string;
  contentType?: string;
}

export interface McpFetchRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpFetchBodyType;
  redirect?: RequestRedirect;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  timeoutMs?: number;
}

export interface McpFetchResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpFetchBodyType;
  url?: string;
  redirected?: boolean;
  ok?: boolean;
}

export interface McpFetchOptions {
  toolName?: string;
  interceptPaths?: string[];
  allowAbsoluteUrls?: boolean;
  fallbackToNative?: boolean;
  timeoutMs?: number;
  shouldIntercept?: (url: URL, request: Request) => boolean;
  isMcpApp?: () => boolean;
  fetch?: typeof fetch;
  installGlobal?: boolean;
}

export interface McpFetchHandle {
  fetch: typeof fetch;
  restore: () => void;
}
