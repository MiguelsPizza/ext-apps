# Example: Hono React Server

A complete example showing how to build MCP Apps using **standard web development patterns** — no UI-only tools, no special APIs, just normal `fetch()` calls with type-safe Hono clients.

## The Key Insight

**UI-only tools are pure overhead.** If the model can't see a tool, why define it as a tool at all?

Instead of this:

```typescript
// ❌ Traditional approach: Define a tool the model can't even use
server.registerTool("get_items", {
  _meta: { ui: { visibility: ["app"] } },  // Model can't call this
}, async () => {
  return db.getItems();
});

// App calls it via MCP
await app.callServerTool("get_items");
```

Do this:

```typescript
// ✅ This example: Just use standard HTTP
// Server: One generic http_request tool proxies all fetch() calls
server.registerTool("http_request", handler);

// App: Normal fetch (or type-safe Hono client)
const res = await client.api.items.$get();
```

The result: **write normal web apps** that work standalone or as MCP apps with zero friction.

> [!TIP]
> Want the same HTTP-adapter pattern without a real HTTP backend? See
> [`examples/basic-server-vanillajs`](../basic-server-vanillajs) for an in-process router example (no upstream server).

## What This Example Demonstrates

1. **Type-safe API calls** using Hono's `hc` client
2. **Dual-mode HTTP** — same code works in dev (direct) and prod (MCP proxied)
3. **Standard web patterns** — React, Hono, Vite, CSS modules
4. **Zero MCP knowledge in the UI** — just normal `fetch()` calls

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React App (mcp-app.tsx)                                        │
│                                                                 │
│  const client = hc<AppType>(baseUrl);                           │
│  await client.api.items.$get();     // Type-safe!               │
│            │                                                    │
│            ▼                                                    │
│  initMcpHttp() intercepts fetch()                               │
└────────────│────────────────────────────────────────────────────┘
             │
             │  Dev mode: direct HTTP
             │  Prod mode: MCP http_request tool
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hono Backend (hono-backend.ts)                                 │
│                                                                 │
│  app.get("/api/items", ...)    // Standard Hono routes          │
│  app.post("/api/items", ...)                                    │
│  app.delete("/api/items/:id", ...)                              │
│                                                                 │
│  export type AppType = typeof app;  // Export for client types  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Development Mode

```bash
npm install
npm run dev
```

This starts the Vite dev server on port 3000 and the Hono backend on port 3102.

Open http://localhost:3000/mcp-app.html in your browser.

- Shows **"Direct HTTP"** mode
- Network tab shows real HTTP requests
- Full debugging, hot reload, normal web dev
- Direct mode uses `VITE_API_BASE_URL` (defaults to `http://localhost:3102`)
- Vite still proxies `/api/*` to the backend (optional when using absolute base URL)

### Production Mode (MCP)

```bash
# From ext-apps root
npm start
```

Open http://localhost:8080, select "hono-react-server".

- Shows **"MCP Proxied"** mode
- Requests route through `http_request` tool
- Full MCP auditability

## Key Code

### Type-Safe Hono Client

```typescript
// hono-backend.ts — Export the app type
export const honoApp = new Hono()
  .get("/api/items", (c) => c.json({ items }))
  .post("/api/items", async (c) => { /* ... */ });

export type AppType = typeof honoApp;
```

```typescript
// mcp-app.tsx — Import and use with full type safety
import { hc } from "hono/client";
import type { AppType } from "./hono-backend.js";

const baseUrl = window.self !== window.top
  ? "/"
  : (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3102");

const client = hc<AppType>(baseUrl);

// Autocomplete knows the return type!
const res = await client.api.items.$get();
const data = await res.json();  // { items: Item[] }

// Type-checked request body
await client.api.items.$post({ json: { name: "New Item" } });

// Type-checked path params
await client.api.items[":id"].$delete({ param: { id: "123" } });
```

### HTTP Wrapper (Transparent Interception)

```typescript
// Initialize once — intercepts fetch() in MCP mode, passes through in dev
initMcpHttp(app, {
  interceptPaths: ["/api/"],
  fallbackToNative: true,
});
```

When running standalone in a normal browser, the app skips host connection
attempts and keeps the UI functional for local dev.

### MCP Server (Generic HTTP Proxy)

```typescript
// One tool handles all HTTP — no per-endpoint definitions needed
server.registerTool("http_request", {
  _meta: { ui: { visibility: ["app"] } },
}, createHttpRequestToolHandler({
  baseUrl: "http://localhost:3102",
  allowPaths: ["/api/"],
}));
```

## Files

| File | Purpose |
|------|---------|
| [`src/hono-backend.ts`](src/hono-backend.ts) | Pure Hono HTTP server — no MCP knowledge |
| [`src/mcp-app.tsx`](src/mcp-app.tsx) | React app with type-safe Hono client |
| [`server.ts`](server.ts) | MCP server with `http_request` tool |
| [`main.ts`](main.ts) | Entry point — starts Hono backend + MCP server |

## Ports

| Service | Default Port | Environment Variable |
|---------|--------------|---------------------|
| MCP Server | 3001 | `PORT` (preferred) or `MCP_PORT` |
| Hono Backend | 3102 (or `PORT + 1000` when `PORT` is set) | `BACKEND_PORT` |

When `PORT` is provided (for example by `examples/run-all.ts`), the MCP server
binds to that port and the backend defaults to `PORT + 1000` to avoid collisions.
Override with `BACKEND_PORT` if you want a different backend port.

## MCP Client Configuration

### Published Package (stdio)

```json
{
  "mcpServers": {
    "hono-react": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-hono-react",
        "--stdio"
      ]
    }
  }
}
```

### Local Development

```json
{
  "mcpServers": {
    "hono-react": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/hono-react-server && npm run build >&2 && node dist/main.js --stdio"
      ]
    }
  }
}
```

## Why This Pattern?

| Traditional MCP Apps | This Pattern |
|---------------------|--------------|
| Define tool per endpoint | One generic `http_request` tool |
| Learn MCP-specific APIs | Use standard `fetch()` / Hono client |
| Separate dev/prod code paths | Same code works everywhere |
| UI-only tools (model can't see) | No overhead — just HTTP |
| Manual type definitions | Type-safe from Hono route definitions |

## Learn More

- [Dual-Mode Pattern Documentation](../../proposal/12-dual-mode-pattern.md)
- [HTTP Adapter Proposal](../../proposal/README.md)
- [Hono Client Documentation](https://hono.dev/docs/guides/rpc)
