# Counterarguments: Why They Built It This Way

This document presents the legitimate reasons behind the current MCP Apps architecture and addresses them with our refined proposal.

## Legitimate Concerns with Our Original Proposal

### 1. Auditability

**Their concern:** Raw HTTP proxying isn't auditable. The host sees URLs and payloads but not semantic meaning.

**Valid point.** With raw fetch proxy:

```
{ type: 'fetch-proxy', url: '/api/xyz', body: '...' }
```

The host can't easily:

- Show meaningful approval dialogs
- Log semantic actions
- Enforce policies by action type

### 2. Trust Boundaries

**Their concern:** Server tools are trusted (from vetted MCP server). App tools are less trusted. The explicit layering lets hosts reason about trust.

**Valid point.** The spec explicitly separates:

- Server tools (trusted, pre-vetted)
- App tools (sandboxed, less trusted)

### 3. Third-Party Cookie Deprecation

**Their concern:** Iframes can't reliably access cookies due to browser restrictions.

**Valid point.** From browser vendors:

- Chrome restricts third-party cookies
- Safari/Firefox block them entirely
- Partitioned cookies (CHIPS) add complexity
- Storage Access API requires user interaction

### 4. Security: Constrained Attack Surface

**Their concern:** Arbitrary fetch allows data exfiltration to any endpoint.

**Valid point.** A malicious app with fetch proxy could:

- POST sensitive data to attacker-controlled servers
- Access internal network resources
- Abuse host credentials

### 5. Schema Validation

**Their concern:** MCP tools have schemas. Arbitrary fetch doesn't.

**Valid point.** Tools provide:

- Input validation before execution
- Output validation after execution
- Type safety for the model

### 6. No Arbitrary Network Access

**Their concern:** Apps should only communicate with declared endpoints.

**Valid point.** The spec requires:

- Pre-declared CSP `connectDomains`
- Host enforcement of allowed origins

---

## Our Refined Solution: MCP All The Way

Instead of raw HTTP proxying, we propose keeping everything in MCP but making it invisible to developers.

### The `http_request` Server Tool

MCP servers register an app-only tool for HTTP proxying:

```typescript
server.registerTool(
  "http_request",
  {
    description: "Proxy HTTP requests from the app to backend APIs",
    inputSchema: z.object({
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
      url: z.string().describe("Relative URL (path + query) to backend API"),
      headers: z.record(z.string()).optional(),
      body: z.any().optional(),
    }),
    _meta: {
      ui: {
        visibility: ["app"], // ONLY app can call, NOT the model
      },
    },
  },
  async ({ method, url, headers, body }, context) => {
    // Server has the auth context from OAuth connection
    const baseUrl = config.apiBaseUrl;
    const authHeaders = await getAuthFromContext(context);

    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...headers, ...authHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });

    return {
      structuredContent: {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      },
    };
  },
);
```

**Key points:**

- `visibility: ["app"]` — Model never sees this tool
- Server has OAuth credentials from connection
- Server knows the backend base URL
- Everything is still MCP JSON-RPC

### The Fetch Wrapper (Iframe Side)

```typescript
// Automatically detects MCP app context
export function initMcpFetch(app: App) {
  const originalFetch = window.fetch;

  // Only wrap if we're in an MCP app context
  if (!app.isConnected()) {
    return; // Normal browser - fetch works as-is
  }

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    // Only intercept relative URLs
    if (!url.startsWith("/")) {
      return originalFetch(input, init);
    }

    // Convert to MCP tool call
    const result = await app.callServerTool("http_request", {
      method: init?.method || "GET",
      url,
      headers: init?.headers
        ? Object.fromEntries(new Headers(init.headers))
        : {},
      body: init?.body,
    });

    // Convert back to Response
    const { status, headers, body } = result.structuredContent;
    return new Response(body, { status, headers: new Headers(headers) });
  };
}
```

### Developer Experience

**Local development (normal browser):**

```typescript
// Just works - normal fetch to your dev server
await fetch("/api/cart", { method: "POST", body: "..." });
```

**In MCP app context:**

```typescript
// Same code - fetch wrapper converts to callServerTool
await fetch("/api/cart", { method: "POST", body: "..." });
// Under the hood: app.callServerTool('http_request', { method: 'POST', url: '/api/cart', ... })
```

**Zero code changes between environments.**

---

## How This Addresses Each Concern

### 1. Auditability ✓

Everything is MCP JSON-RPC:

```json
{
  "method": "tools/call",
  "params": {
    "name": "http_request",
    "arguments": {
      "method": "POST",
      "url": "/api/cart",
      "body": { "itemId": "123" }
    }
  }
}
```

The host can:

- Log all backend communication
- Show meaningful audit trails
- Enforce rate limits per-path prefix

### 2. Trust Boundaries ✓

- `http_request` is a SERVER tool (trusted)
- But with `visibility: ["app"]` (only app calls it)
- Model never sees or calls this tool
- WebMCP tools are what the model interacts with

### 3. Cookie/Auth ✓

- Iframe never touches cookies
- MCP server has OAuth credentials from connection
- Server makes authenticated requests
- No third-party cookie issues

### 4. Constrained Attack Surface ✓

- `http_request` tool validates URLs/prefixes
- Server controls base URL
- Server can enforce URL/path allowlists
- No arbitrary URL access

### 5. Schema Validation ✓

The `http_request` tool has:

- Input schema (method, url, headers, body)
- Output schema (status, headers, body)
- Full MCP validation

### 6. Controlled Network Access ✓

- Server declares which backend it proxies to
- Host knows the MCP server is trusted
- No direct network access from iframe

---

## Architecture Comparison

### Current (PR #72)

```
Model calls app tool
    ↓
App tool wraps server tool
    ↓
Server tool does actual work

= Double-wrapping, boilerplate
```

### Proposed (Refined)

```
Model calls WebMCP tool (UI action)
    ↓
WebMCP tool executes app logic
    ↓
App logic calls fetch()
    ↓
Fetch wrapper converts to callServerTool('http_request')
    ↓
MCP server makes authenticated HTTP request

= Single code path, no boilerplate, full auditability
```

---

## Remaining Open Issues (Not Deal-Breakers)

1. **Transport multiplexing** — WebMCP tools and MCP App UI both use JSON-RPC over `postMessage`. We need channel tagging or a mux to prevent message collisions.
2. **Streaming extensions** — WS/SSE/streaming are possible via MCP notifications but require explicit protocol definitions and host forwarding.
3. **Standard `http_request` contract** — Input/output schemas must be standardized to avoid fragmentation.

## What We Keep from Current Architecture

1. **`callServerTool`** — Used internally by fetch wrapper
2. **Tool visibility** — `["app"]` vs `["model"]` distinction
3. **MCP JSON-RPC everywhere** — Full auditability
4. **Server-side auth** — OAuth credentials on MCP server
5. **Schema validation** — Input/output validation

## What We Change

1. **No app tool wrappers** — Model uses WebMCP, not app-registered tools
2. **fetch() just works** — Wrapper handles MCP conversion
3. **Isomorphic code** — Same code in browser and MCP app
4. **WebMCP for model tools** — Standard API, not custom SDK

---

## The Complete Picture

| Layer            | Responsibility                 | Implementation                                 |
| ---------------- | ------------------------------ | ---------------------------------------------- |
| **WebMCP Tools** | What model can do (UI actions) | `navigator.modelContext.registerTool()`        |
| **App Logic**    | Business logic, state          | Normal JS/TS functions                         |
| **fetch()**      | Backend communication          | Wrapper → `callServerTool('http_request')`     |
| **MCP Server**   | Auth, actual HTTP calls        | `http_request` tool with `visibility: ["app"]` |

**The model interacts with WebMCP tools. The app makes fetch calls. Everything flows through auditable MCP. Auth lives on the server.**
