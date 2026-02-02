# MCP Fetch Wrapper: Transparent Backend Communication via MCP

The MCP fetch wrapper lets MCP Apps call normal `fetch()` while keeping every request as auditable MCP JSON-RPC.

## The Problem

MCP Apps run in sandboxed iframes:
- Different origin from host
- No access to host cookies/session
- Third-party cookies are being deprecated

Current solution: `app.callServerTool()` — every backend call must be an MCP tool wrapper.

**Proposed solution:** A fetch wrapper that converts `fetch()` into `callServerTool("http_request")`, implemented as an app-only MCP server tool.

## Core Flow (MCP All The Way)

1. **Iframe:** `fetch('/api/cart')` → wrapper converts to `callServerTool("http_request", {...})`
2. **Host:** Forwards MCP tool call to server (auditable JSON-RPC)
3. **MCP Server:** Executes `http_request` with OAuth credentials
4. **Response:** Returned via MCP, reconstructed into `Response`


**Benefits:**
- Full auditability (pure MCP JSON-RPC)
- Auth lives on MCP server (OAuth from connection)
- No third-party cookie reliance
- Schema validation on input/output
- Server controls allowed paths and base URL

**Reality check:** Today, the MCP server already sees *everything* as tools/call. This proposal keeps that model — it just hides the tool layer behind `fetch()` so app code stays normal.

## Web-Standards-Aligned Tool Contract (Proposed)

This contract intentionally mirrors the **WHATWG Fetch** model (Request/Response). It is a **subset** of the Fetch standard that can be transported over MCP JSON‑RPC.

Key alignment points:
- **Request** fields map to `RequestInit` (`method`, `headers`, `body`, `redirect`, `cache`, etc.)
- **Response** fields map to `Response` (`status`, `statusText`, `headers`, `body`)
- **Headers** follow Fetch’s case‑insensitive semantics (host should normalize)
- **Forbidden headers** (`cookie`, `host`, `authorization`, etc.) are blocked by host policy

The host/server may ignore unsupported fields, but MUST preserve the semantics for the supported subset.

### Input Schema

```typescript
z.object({
  // Fetch-aligned fields (subset)
  method: z.string().default("GET"),
  url: z.string().describe("Relative URL (path + query), e.g. '/api/cart?x=1'"),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  bodyType: z.enum([
    "none",
    "json",
    "text",
    "formData",
    "urlEncoded",
    "base64"
  ]).optional(),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  cache: z.enum(["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"]).optional(),
  credentials: z.enum(["omit", "same-origin", "include"]).optional(),
  timeoutMs: z.number().optional()
})
```

### Output Schema

```typescript
z.object({
  status: z.number(),
  statusText: z.string().optional(),
  headers: z.record(z.string()),
  body: z.any(),
  bodyType: z.enum(["json", "text", "base64", "formData", "urlEncoded", "none"]),
  url: z.string().optional(),
  redirected: z.boolean().optional(),
  ok: z.boolean().optional()
})
```

**Notes:**
- `url` MUST be relative by default; hosts MAY allow absolute URLs via allowlists.
- For `GET`/`HEAD`, servers SHOULD ignore `body`.
- `formData` should be encoded as an array of `{ name, value, filename?, contentType? }` or converted to `urlEncoded` when possible.

## MCP Server: `http_request` Tool

```typescript
server.registerTool("http_request", {
  description: "Proxy HTTP requests from the app to backend APIs",
  inputSchema: HttpRequestInputSchema,
  outputSchema: HttpRequestOutputSchema,
  _meta: { ui: { visibility: ["app"] } } // app-only
}, async ({ method, url, headers, body, bodyType, redirect, cache }, context) => {
  const baseUrl = process.env.API_BASE_URL!;
  const authHeaders = await getAuthHeaders(context);

  if (!isAllowedPath(url)) {
    throw new Error(`Path not allowed: ${url}`);
  }

  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...authHeaders,
    },
    body: body ? encodeBody(body, bodyType) : undefined,
    redirect,
    cache,
  });

  return {
    structuredContent: {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: await decodeBody(response, "text"),
      bodyType: "text",
    },
  };
});
```

## Iframe: Fetch Wrapper

```typescript
import { App } from "@modelcontextprotocol/ext-apps";

export function initMcpFetch(app: App, options = {}) {
  const originalFetch = window.fetch;
  const interceptPaths = options.interceptPaths ?? ["/"];

  window.fetch = async (input, init) => {
    const url = normalizeUrl(input);

    if (!shouldIntercept(url, interceptPaths)) {
      return originalFetch(input, init);
    }

    // Requires app.connect() to have completed
    const result = await app.callServerTool({
      name: "http_request",
      arguments: {
        method: init?.method ?? "GET",
        url,
        headers: init?.headers
          ? Object.fromEntries(new Headers(init.headers))
          : undefined,
        body: init?.body ? parseBody(init.body) : undefined,
        bodyType: inferBodyType(init?.body),
        redirect: init?.redirect,
        cache: init?.cache,
      },
    });

    return mcpResultToResponse(result);
  };
}
```

**Note:** For local dev, simply skip `initMcpFetch()` or gate it behind an `isMcpApp` check. The wrapper assumes a connected `App`.

## Transport Multiplexing (Important)

The refined architecture runs two MCP JSON-RPC streams in one iframe:

1. **WebMCP tools** via `@mcp-b/transports`
2. **MCP App protocol + `callServerTool`** via `PostMessageTransport`

These must be multiplexed to avoid message collisions. We should standardize one of:

- **Channel tagging** (e.g., `{ channel: "webmcp" | "ui" }`)
- **MessagePort** separation (postMessage a dedicated port for WebMCP)
- **Shared mux transport** inside ext-apps

Without this, tools/call and notifications are ambiguous.

## Extensions: WebSocket, SSE, Streaming

These are possible via MCP notifications, but require a defined protocol and host forwarding.

### WebSocket via MCP

- `ws_connect` tool returns `connectionId`
- Server forwards messages as `notifications/ws_message`
- `ws_send` and `ws_close` tools handle outbound + teardown

### Server-Sent Events via MCP

- `sse_connect` tool returns `connectionId`
- Server forwards `notifications/sse_event`
- `sse_close` tool closes connection

### Streaming Responses

- `http_request_stream` returns `streamId`
- Server emits `notifications/stream_chunk` + `notifications/stream_end`
- Wrapper exposes a `ReadableStream`

### Requirements for Extensions

- Host must forward these notifications to the iframe
- Protocol must specify connection IDs, ordering, and backpressure
- Apps must handle reconnection + cleanup

## Security Considerations

- **Allowlist paths**: server rejects anything outside known prefixes
- **Header filtering**: block `cookie`, `authorization`, `host`, etc.
- **Payload limits**: enforce max body size
- **Rate limits**: per app or per path

## Summary

The MCP fetch wrapper keeps all traffic in MCP JSON-RPC, preserves auditability, and avoids cookie issues. It does introduce a need for transport multiplexing and a standardized `http_request` contract, but it remains simpler than dual tool layers and keeps the UI codepath unified.
