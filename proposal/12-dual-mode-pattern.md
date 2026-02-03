# Dual-Mode Development Pattern

> Write once, run anywhere: the same app code works in development (direct HTTP) and production (MCP proxied)

## Overview

The dual-mode pattern enables MCP Apps to use standard `fetch()` calls that automatically adapt based on the runtime environment:

- **Development (standalone):** `fetch()` → HTTP backend (direct)
- **Production (iframe):** `fetch()` → MCP wrapper → Host → MCP Server → `http_request` tool → HTTP backend

**Change note (2026-02-03):** In the SDK used by this proposal, the React `useApp`
hook now skips host connection attempts when running outside an iframe. This
avoids hard errors during standalone development and does not change the MCP
Apps specification.

This means **zero code changes** between development and production. Developers get a normal web development experience with hot reload and network debugging, while production maintains full MCP auditability.

## Architecture

### Development Mode

```
┌─────────────────────────────────────────┐
│  Browser (standalone)                   │
│  ┌───────────────────────────────────┐  │
│  │  React App                        │  │
│  │  fetch('/api/time') ─────────────────────► HTTP Backend
│  │                     direct HTTP   │  │     (Hono/Express/etc)
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

- App runs directly in browser (no iframe)
- `fetch()` calls go directly to HTTP backend
- Full network debugging in DevTools
- Hot reload works normally

### Production Mode

```
┌──────────────────────────────────────────────────────────────────────┐
│  Host (Claude Desktop, etc)                                          │
│  ┌────────────────────────────────────┐                              │
│  │  Iframe (sandboxed)                │                              │
│  │  ┌──────────────────────────────┐  │                              │
│  │  │  React App                   │  │                              │
│  │  │  fetch('/api/time')          │  │                              │
│  │  │       │                      │  │                              │
│  │  │       ▼                      │  │                              │
│  │  │  initMcpHttp() wrapper       │  │                              │
│  │  │       │                      │  │                              │
│  │  └───────│──────────────────────┘  │                              │
│  │          │ postMessage             │                              │
│  └──────────│─────────────────────────┘                              │
│             ▼                                                        │
│       Host receives                                                  │
│       callServerTool("http_request")                                 │
│             │                                                        │
└─────────────│────────────────────────────────────────────────────────┘
              │ MCP JSON-RPC
              ▼
┌─────────────────────────────────────┐
│  MCP Server                         │
│  http_request tool handler          │
│       │                             │
│       ▼                             │
│  fetch() → HTTP Backend             │
│            (Hono/Express/etc)       │
└─────────────────────────────────────┘
```

- App runs in sandboxed iframe
- `fetch()` intercepted by MCP wrapper
- Requests proxied through MCP JSON-RPC
- Full auditability maintained
- Same backend code handles both modes

## Detection Mechanism

The http-adapter automatically detects the runtime environment:

```typescript
// In src/http-adapter/fetch-wrapper/fetch.ts
const isMcpApp = options.isMcpApp ?? (() =>
  Boolean(app.getHostCapabilities()?.serverTools)
);
```

When `isMcpApp()` returns:
- `true`: Intercept fetch, route through MCP `http_request` tool
- `false`: Use native fetch directly (if `fallbackToNative: true`)

Alternative detection methods:
- `window.parent !== window` (iframe detection)
- `window.self !== window.top` (nested browsing context)

## Implementation

### Client-Side (React App)

```typescript
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { initMcpHttp } from "@modelcontextprotocol/ext-apps/http-adapter";

function App() {
  const { app } = useApp({
    appInfo: { name: "My App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      // Initialize HTTP wrapper - automatically detects mode
      initMcpHttp(app, {
        interceptPaths: ["/api/"],
        fallbackToNative: true,  // Use direct HTTP when not in MCP host
      });
    },
  });

  // This fetch() works in BOTH modes!
  const fetchData = async () => {
    const res = await fetch("/api/data");
    return res.json();
  };

  return <button onClick={fetchData}>Fetch Data</button>;
}
```

### Client-Side (Vanilla JS)

```typescript
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpHttp } from "@modelcontextprotocol/ext-apps/http-adapter";

const app = new App({ name: "My App", version: "1.0.0" }, {});

// Connect only when running inside an iframe (standalone dev-friendly)
if (window.self !== window.top) {
  await app.connect(new PostMessageTransport(window.parent, window.parent));
}

initMcpHttp(app, {
  interceptPaths: ["/api/"],
  fallbackToNative: true,
});
```

### Server-Side (MCP Server)

```typescript
import { createHttpRequestToolHandler } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

// Register http_request tool that proxies to your HTTP backend
server.registerTool("http_request", {
  description: "Proxy HTTP requests from app to backend",
  inputSchema: httpRequestInputSchema,
  _meta: { ui: { visibility: ["app"] } },  // App-only, not exposed to model
}, createHttpRequestToolHandler({
  baseUrl: "http://localhost:3001",  // Your HTTP backend
  allowPaths: ["/api/"],
  allowOrigins: ["http://localhost:3001"],
}));
```

### HTTP Backend (Any Language/Framework)

The beauty of this pattern: your HTTP backend is completely MCP-agnostic.

**Hono (TypeScript):**
```typescript
import { Hono } from "hono";

const app = new Hono();
app.get("/api/time", (c) => c.json({ time: new Date().toISOString() }));
```

**Express (Node.js):**
```typescript
app.get("/api/time", (req, res) => res.json({ time: new Date().toISOString() }));
```

**Flask (Python):**
```python
@app.route("/api/time")
def get_time():
    return jsonify({"time": datetime.now().isoformat()})
```

**Any web framework works** - Go, Ruby, Rust, etc.

## Developer Experience

### Development Workflow

1. Start your HTTP backend (Hono, Express, Flask, etc.)
2. Start your frontend dev server (Vite)
3. Open `http://localhost:5173` in browser
4. Edit code, see changes, debug normally

If you use relative URLs like `/api/*`, configure your dev server to proxy those
requests to the backend (e.g., Vite `server.proxy`), or set a base URL in your
client.

```bash
# Terminal 1: HTTP backend
npm run backend  # Starts Hono on port 3001

# Terminal 2: Frontend dev server
npm run dev      # Starts Vite on port 5173
```

Network tab shows real HTTP requests. Console shows real errors. Hot reload works. Standard web development.

### Production Workflow

1. Build the app (bundles into single HTML)
2. Run MCP server (includes http_request tool)
3. Connect via MCP host (Claude Desktop, etc.)

The same code "just works" - the http-adapter detects it's in an MCP host and routes through the tool automatically.

## Security Considerations

The dual-mode pattern preserves MCP's security model:

### Path Allowlists

Both modes can enforce path restrictions:

```typescript
// Server-side (production)
createHttpRequestToolHandler({
  allowPaths: ["/api/"],  // Only /api/* allowed
});

// Client-side (optional, for dev consistency)
initMcpHttp(app, {
  interceptPaths: ["/api/"],
});
```

### Header Filtering

Sensitive headers are automatically stripped in production:
- `cookie`, `set-cookie`
- `authorization`, `proxy-authorization`
- `host`, `origin`, `referer`

### OAuth Scopes and Authorization

If your MCP server enforces OAuth scopes, you can map scopes to routes/methods
inside the `http_request` handler instead of defining per-action tools. The UI
remains untrusted; the server is the enforcement point.

```typescript
const scopeMap = [
  { method: "GET", path: "/api/items", scopes: ["items:read"] },
  { method: "POST", path: "/api/items", scopes: ["items:write"] },
];

function requireScopes(request: McpHttpRequest) {
  const rule = scopeMap.find((entry) =>
    entry.method === request.method && request.url.startsWith(entry.path),
  );
  if (!rule) return;
  // Enforce OAuth scopes here (token validation omitted for brevity)
}
```

### Body Size Limits

```typescript
createHttpRequestToolHandler({
  maxBodySize: 10 * 1024 * 1024,  // 10MB default
});
```

### Origin Allowlists

```typescript
createHttpRequestToolHandler({
  allowOrigins: ["https://api.example.com"],
});
```

## Benefits

| Aspect | Benefit |
|--------|---------|
| **Development Speed** | Normal web dev workflow, no MCP overhead |
| **Debugging** | Real network requests visible in DevTools |
| **Hot Reload** | Works naturally with Vite/webpack |
| **Testing** | Test backend with curl, Postman, etc. |
| **Backend Language** | Any HTTP server works (Node, Python, Go, etc.) |
| **Code Reuse** | Zero duplication between dev/prod |
| **Auditability** | Full MCP JSON-RPC trail in production |
| **Security** | Same allowlists enforced in both modes |

## Comparison with Tool-Per-Endpoint

### Traditional MCP Apps (Tool per Endpoint)

```typescript
// Server: Define tool for each operation
server.registerTool("get_time", schema, async () => ({ time: new Date().toISOString() }));
server.registerTool("get_items", schema, async () => ({ items: [...] }));
server.registerTool("add_item", schema, async ({ name }) => { /* ... */ });

// App: Call tools directly
await app.callServerTool("get_time");
await app.callServerTool("add_item", { name: "test" });
```

### Dual-Mode Pattern (Single http_request Tool)

```typescript
// Server: One generic tool + standard HTTP backend
server.registerTool("http_request", schema, createHttpRequestToolHandler({ baseUrl }));

// App: Standard fetch (works in dev too!)
await fetch("/api/time");
await fetch("/api/items", { method: "POST", body: JSON.stringify({ name: "test" }) });
```

The dual-mode pattern is better for REST-backed apps. The tool-per-endpoint approach is still valid for non-HTTP backends or when you want explicit tool semantics.

## Example: hono-react-server

See `examples/hono-react-server/` for a complete working implementation:

- **Frontend:** React with `useApp` hook
- **Backend:** Hono serving `/api/*` routes
- **MCP Server:** `http_request` tool proxying to Hono
- **Mode Detection:** Shows "Direct HTTP" or "MCP Proxied" in UI

```bash
# Run in dev mode (direct HTTP)
cd examples/hono-react-server
npm run dev
# Open http://localhost:3000/mcp-app.html

# Run in prod mode (MCP proxied)
cd /path/to/ext-apps
npm start
# Open http://localhost:8080 and select hono-react-server
```
