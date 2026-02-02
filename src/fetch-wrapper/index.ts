/**
 * Fetch wrapper for MCP Apps.
 *
 * Converts fetch() calls into MCP server tool calls (default: "http_request")
 * when running inside a host. When not connected to an MCP host, it can
 * transparently fall back to native fetch for local development.
 *
 * @module @modelcontextprotocol/ext-apps/fetch-wrapper
 */
import type { App } from "../app.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpFetchBodyType,
  McpFetchFormField,
  McpFetchHandle,
  McpFetchOptions,
  McpFetchRequest,
  McpFetchResponse,
} from "./types.js";

export type {
  McpFetchBodyType,
  McpFetchFormField,
  McpFetchHandle,
  McpFetchOptions,
  McpFetchRequest,
  McpFetchResponse,
} from "./types.js";

const DEFAULT_TOOL_NAME = "http_request";
const DEFAULT_INTERCEPT_PATHS = ["/"];

export function initMcpFetch(
  app: App,
  options: McpFetchOptions = {},
): McpFetchHandle {
  const nativeFetch = options.fetch ?? globalThis.fetch;
  if (!nativeFetch) {
    throw new Error("global fetch is not available in this environment");
  }

  const mcpFetch = createMcpFetch(app, nativeFetch, options);
  if (options.installGlobal ?? true) {
    globalThis.fetch = mcpFetch;
  }

  return {
    fetch: mcpFetch,
    restore: () => {
      if (globalThis.fetch === mcpFetch) {
        globalThis.fetch = nativeFetch;
      }
    },
  };
}

function createMcpFetch(
  app: App,
  nativeFetch: typeof fetch,
  options: McpFetchOptions,
): typeof fetch {
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const interceptPaths = options.interceptPaths ?? DEFAULT_INTERCEPT_PATHS;
  const allowAbsoluteUrls = options.allowAbsoluteUrls ?? false;
  const fallbackToNative = options.fallbackToNative ?? true;
  const isMcpApp =
    options.isMcpApp ??
    (() => Boolean(app.getHostCapabilities()?.serverTools));

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      throw createAbortError();
    }

    const request = new Request(input, init);
    const resolvedUrl = new URL(request.url, getBaseUrl());
    const baseOrigin = getBaseOrigin(resolvedUrl);
    const isSameOrigin = baseOrigin
      ? resolvedUrl.origin === baseOrigin
      : true;
    const relativeUrl = `${resolvedUrl.pathname}${resolvedUrl.search}`;
    const toolUrl =
      isSameOrigin || !allowAbsoluteUrls ? relativeUrl : resolvedUrl.toString();

    const shouldIntercept = options.shouldIntercept
      ? options.shouldIntercept(resolvedUrl, request)
      : defaultShouldIntercept({
          isMcpApp: isMcpApp(),
          allowAbsoluteUrls,
          isSameOrigin,
          path: relativeUrl,
          interceptPaths,
        });

    if (!shouldIntercept) {
      return nativeFetch(input, init);
    }

    if (!isMcpApp()) {
      if (fallbackToNative) {
        return nativeFetch(input, init);
      }
      throw new Error("MCP host connection is not available for fetch proxying");
    }

    const { body, bodyType } = await serializeRequestBody(request, init?.body);
    const payload: McpFetchRequest = stripUndefined({
      method: request.method,
      url: toolUrl,
      headers: headersToRecord(request.headers),
      body,
      bodyType,
      redirect: request.redirect,
      cache: request.cache,
      credentials: request.credentials,
      timeoutMs: options.timeoutMs,
    });

    const callOptions = init?.signal ? { signal: init.signal } : undefined;
    const result = await app.callServerTool(
      { name: toolName, arguments: payload },
      callOptions,
    );

    if (result.isError) {
      throw new Error(extractToolError(result));
    }

    const responsePayload = extractResponsePayload(result);
    return buildResponse(responsePayload);
  };
}

function defaultShouldIntercept({
  isMcpApp,
  allowAbsoluteUrls,
  isSameOrigin,
  path,
  interceptPaths,
}: {
  isMcpApp: boolean;
  allowAbsoluteUrls: boolean;
  isSameOrigin: boolean;
  path: string;
  interceptPaths: string[];
}): boolean {
  if (!isMcpApp) {
    return false;
  }
  if (!isSameOrigin && !allowAbsoluteUrls) {
    return false;
  }
  if (interceptPaths.length === 0) {
    return false;
  }
  const normalizedPath = normalizePath(path);
  return interceptPaths.some((prefix) =>
    normalizedPath.startsWith(normalizePath(prefix)),
  );
}

function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.href) {
    return window.location.href;
  }
  return "http://localhost";
}

function getBaseOrigin(url: URL): string | undefined {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return url.origin;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

async function serializeRequestBody(
  request: Request,
  initBody: BodyInit | null | undefined,
): Promise<{ body?: unknown; bodyType?: McpFetchBodyType }> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return { bodyType: "none", body: undefined };
  }

  if (initBody !== undefined) {
    return await serializeBodyInit(initBody, request.headers.get("content-type"));
  }

  if (!request.body) {
    return { bodyType: "none", body: undefined };
  }

  return await serializeBodyFromRequest(
    request.clone(),
    request.headers.get("content-type"),
  );
}

async function serializeBodyInit(
  body: BodyInit | null,
  contentType: string | null,
): Promise<{ body?: unknown; bodyType?: McpFetchBodyType }> {
  if (body == null) {
    return { bodyType: "none", body: undefined };
  }

  if (typeof body === "string") {
    return serializeStringBody(body, contentType);
  }

  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return { bodyType: "urlEncoded", body: body.toString() };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { bodyType: "formData", body: await formDataToFields(body) };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    const buffer = await body.arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  if (body instanceof ArrayBuffer) {
    return { bodyType: "base64", body: toBase64(new Uint8Array(body)) };
  }

  if (ArrayBuffer.isView(body)) {
    const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return { bodyType: "base64", body: toBase64(view) };
  }

  if (
    typeof ReadableStream !== "undefined" &&
    body instanceof ReadableStream
  ) {
    const buffer = await new Response(body).arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  return { bodyType: "text", body: String(body) };
}

async function serializeBodyFromRequest(
  request: Request,
  contentType: string | null,
): Promise<{ body?: unknown; bodyType?: McpFetchBodyType }> {
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedType.includes("application/json")) {
    const text = await request.text();
    const parsed = safeJsonParse(text);
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
    return { bodyType: "text", body: text };
  }

  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body: await request.text() };
  }

  if (
    normalizedType.includes("multipart/form-data") &&
    typeof request.formData === "function"
  ) {
    try {
      const formData = await request.formData();
      return { bodyType: "formData", body: await formDataToFields(formData) };
    } catch {
      // Fall through to text/binary handling.
    }
  }

  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("application/xml") ||
    normalizedType.includes("application/javascript")
  ) {
    return { bodyType: "text", body: await request.text() };
  }

  const buffer = await request.arrayBuffer();
  return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
}

function serializeStringBody(
  body: string,
  contentType: string | null,
): { body?: unknown; bodyType?: McpFetchBodyType } {
  const normalizedType = (contentType ?? "").toLowerCase();
  if (normalizedType.includes("application/json")) {
    const parsed = safeJsonParse(body);
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
  }
  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body };
  }
  return { bodyType: "text", body };
}

async function formDataToFields(formData: FormData): Promise<McpFetchFormField[]> {
  const fields: McpFetchFormField[] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
      continue;
    }
    const buffer = await value.arrayBuffer();
    fields.push({
      name,
      data: toBase64(new Uint8Array(buffer)),
      filename: "name" in value ? value.name : undefined,
      contentType: value.type || undefined,
    });
  }
  return fields;
}

function extractResponsePayload(result: CallToolResult): McpFetchResponse {
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (structured && typeof structured === "object") {
    return structured as McpFetchResponse;
  }

  const text = extractTextContent(result);
  if (text) {
    const parsed = safeJsonParse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as McpFetchResponse;
    }
  }

  throw new Error("http_request did not return structured content");
}

function extractToolError(result: CallToolResult): string {
  const text = extractTextContent(result);
  return text ?? "MCP tool returned an error";
}

function extractTextContent(result: CallToolResult): string | undefined {
  const blocks = (result as { content?: Array<{ type: string; text?: string }> })
    .content;
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

function buildResponse(payload: McpFetchResponse): Response {
  const headers = new Headers(payload.headers ?? {});
  const status = payload.status ?? 200;
  const statusText = payload.statusText ?? "";
  const body = decodeResponseBody(payload.body, payload.bodyType);
  return new Response(body, { status, statusText, headers });
}

function decodeResponseBody(
  body: unknown,
  bodyType?: McpFetchBodyType,
): BodyInit | null {
  if (!bodyType || bodyType === "none") {
    return null;
  }

  switch (bodyType) {
    case "json":
      if (typeof body === "string") {
        return body;
      }
      return JSON.stringify(body ?? null);
    case "text":
      return body == null ? "" : String(body);
    case "urlEncoded":
      if (typeof body === "string") {
        return body;
      }
      if (body && typeof body === "object") {
        return new URLSearchParams(body as Record<string, string>).toString();
      }
      return "";
    case "formData":
      if (typeof FormData === "undefined") {
        return body == null ? "" : JSON.stringify(body);
      }
      return fieldsToFormData(body);
    case "base64":
      return decodeBase64Body(body);
    default:
      return body == null ? null : String(body);
  }
}

function fieldsToFormData(body: unknown): FormData {
  const formData = new FormData();
  if (!Array.isArray(body)) {
    return formData;
  }
  for (const entry of body) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const field = entry as McpFetchFormField;
    if (!field.name) {
      continue;
    }
    if (field.data) {
      const bytes = fromBase64(field.data);
      const blob = new Blob([bytes], {
        type: field.contentType ?? "application/octet-stream",
      });
      if (field.filename) {
        formData.append(field.name, blob, field.filename);
      } else {
        formData.append(field.name, blob);
      }
      continue;
    }
    formData.append(field.name, field.value ?? "");
  }
  return formData;
}

function decodeBase64Body(body: unknown): Uint8Array | null {
  if (typeof body === "string") {
    return fromBase64(body);
  }
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: string }).data;
    if (typeof data === "string") {
      return fromBase64(data);
    }
  }
  return null;
}

function safeJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createAbortError(): Error {
  try {
    return new DOMException("The operation was aborted.", "AbortError");
  } catch {
    const error = new Error("The operation was aborted.");
    (error as Error & { name: string }).name = "AbortError";
    return error;
  }
}
