# MCP Apps + WebMCP Integration Proposal

> Reducing friction for porting web apps to MCP Apps, while preserving MCP's auditability and trust model

## Overview

**The current MCP Apps spec is coherent and security-first.** It makes real sense for its goals:

- **Tool-first semantics** — Everything is explicit MCP tools, so hosts can audit, gate, and reason about actions
- **Transport-agnostic** — Works with any backend or service logic, not just REST/GraphQL
- **Clear security boundaries** — Apps are sandboxed UIs; the host/server remain the trusted execution boundary
- **No cookie reliance** — Doesn't depend on browser cookies or host HTTP proxying

**Where the current spec is costly** for web developers:

- **Web-app porting friction** — You can't drop in existing fetch-based code; backend calls must be wrapped as server tools
- **Per-endpoint tool definitions** — Every REST endpoint needs a corresponding server tool
- **Duplicated code paths** — UI actions and model actions often require parallel wiring

**Our proposal keeps the spec intact** but adds:

1. **WebMCP for tool registration** — Apps expose tools via `navigator.modelContext` (emerging web standard)
2. **Standard `http_request` tool** — A generic, app-only server tool for HTTP communication
3. **MCP fetch wrapper** — `fetch()` transparently converts to `callServerTool("http_request")`

The result: **developers write normal web apps** that work standalone or as MCP apps with minimal changes, **without breaking MCP's auditability or trust model**.

## Documents

| Document                                                     | Description                                    |
| ------------------------------------------------------------ | ---------------------------------------------- |
| [01-vision.md](./01-vision.md)                               | High-level concept and motivation              |
| [02-current-architecture.md](./02-current-architecture.md)   | How MCP Apps work today (PR #72)               |
| [03-webmcp-overview.md](./03-webmcp-overview.md)             | WebMCP standard and polyfill                   |
| [04-proposed-architecture.md](./04-proposed-architecture.md) | The new model in detail                        |
| [05-fetch-proxy.md](./05-fetch-proxy.md)                     | MCP fetch wrapper implementation               |
| [06-code-paths.md](./06-code-paths.md)                       | What changes in ext-apps SDK                   |
| [07-migration-guide.md](./07-migration-guide.md)             | How existing apps would migrate                |
| [08-proof-of-concept.md](./08-proof-of-concept.md)           | PoC implementation plan                        |
| [09-complexity-analysis.md](./09-complexity-analysis.md)     | Current model vs. proposed (honest comparison) |
| [10-counterarguments.md](./10-counterarguments.md)           | Addressing legitimate concerns                 |
| [11-edge-cases.md](./11-edge-cases.md)                       | Protocols, transports, and limitations         |

## Quick Comparison

### Current Model (PR #72)

```typescript
// === SERVER: Define tool for each backend operation ===
server.registerTool("cart_add", schema, async ({ itemId }) => {
  await db.cart.add(itemId);
  return { content: [{ type: "text", text: "Added" }] };
});

// === APP: Use app.registerTool() for model interaction ===
const app = new App(
  { name: "Shop", version: "1.0" },
  { tools: { listChanged: true } },
);

app.registerTool(
  "add_to_cart",
  {
    inputSchema: z.object({ itemId: z.string() }),
  },
  async ({ itemId }) => {
    cart.push(itemId);
    await app.callServerTool("cart_add", { itemId }); // Backend call via server tool
    return { content: [{ type: "text", text: "Added" }] };
  },
);

await app.connect();
```

### Proposed Model

```typescript
// === SERVER: One generic http_request tool (app-only) ===
server.registerTool("http_request", {
  inputSchema: z.object({ method: z.string(), url: z.string(), body: z.any().optional() }),
  _meta: { ui: { visibility: ["app"] } }  // Model can't call this directly
}, async ({ method, url, body }) => {
  return fetch(baseUrl + url, { method, body, headers: authHeaders });
});

// === APP: Normal web app with fetch ===
async function addToCart(itemId: string) {
  cart.push(itemId);
  await fetch('/api/cart', { method: 'POST', body: JSON.stringify({ itemId }) });
  // fetch() transparently converts to callServerTool('http_request')
}

// UI uses normal functions
<button onClick={() => addToCart(item.id)}>Add to Cart</button>

// WebMCP tool wraps same function (model calls this)
navigator.modelContext.registerTool({
  name: "add_to_cart",
  inputSchema: { itemId: { type: "string" } },
  handler: async ({ itemId }) => {
    await addToCart(itemId);  // Same function the button calls!
    return { success: true };
  }
});
```

## Key Principles

1. **Same code path for user and model** — Both trigger identical application logic
2. **WebMCP for tool registration** — Use `navigator.modelContext` instead of `app.registerTool()`
3. **fetch() for backend communication** — Wrapper converts to MCP, no per-endpoint server tools needed
4. **Portable apps** — Same app runs as standalone website, MCP app, or PWA
5. **Standards-aligned** — WebMCP is on track for W3C standardization

**Note:** UI-control tools (like map's `navigate-to`) exist in both approaches — we just use WebMCP to register them instead of `app.registerTool()`.

## The Friction Point (Not a Bug)

PR #72 adds app tool registration via `app.registerTool()`, which is correct for the spec's security-first goals. **This isn't broken — it's just high-friction for porting normal web apps.**

For REST-backed apps, the current pattern requires:

```typescript
// Server: Define tool for each backend operation
server.registerTool("cart_add", schema, async ({ itemId }) =>
  db.cart.add(itemId),
);
server.registerTool("cart_remove", schema, async ({ itemId }) =>
  db.cart.remove(itemId),
);
// ... one tool per endpoint

// App: Call server tools (can't just use fetch)
await app.callServerTool("cart_add", { itemId });
```

This is **deliberate** — it ensures all backend communication is explicit and auditable. But it means:

- Existing fetch-based code must be rewritten
- Every REST endpoint needs a server tool definition
- Apps aren't portable to non-MCP contexts

**The current model can do everything our proposal does — it's just more manual for REST-backed apps.**

**See [09-complexity-analysis.md](./09-complexity-analysis.md) for full analysis.**

## Our Refined Solution

We keep everything as auditable MCP JSON-RPC while making it invisible to developers:

1. **WebMCP tools** — Model-facing tools registered via `navigator.modelContext`
2. **Fetch wrapper** — Converts `fetch()` to `callServerTool('http_request')`
3. **`http_request` server tool** — App-only (`visibility: ["app"]`), transport primitive for backend calls

```
Model → WebMCP Tool → App Logic → fetch() → callServerTool('http_request') → Host → MCP Server → Backend
                         ↑                                                        ↑
                         └──── Same code path as button click ────────────────────┘
```

**See [10-counterarguments.md](./10-counterarguments.md) for how this addresses security/auditability concerns.**

## Implementation Plan

This plan keeps dev mode as a normal web app while enabling MCP behavior only when the app runs inside a host.

### Phase 0 — Contract + Naming

1. **Keep `http_request` as the transport primitive** (wire format only).
2. **Define the minimal schema** (method, path, headers, body, responseType).
3. **Document that servers may route `http_request` to any internal handler** (not necessarily real HTTP).

### Phase 1 — SDK: Fetch Wrapper (App Side)

1. **Add `initMcpFetch(app)`** as a small wrapper module that:
   - Intercepts `fetch()` only when the host is present **and** `http_request` is available.
   - Falls back to native `fetch()` in dev/standalone mode.
2. **Expose configuration hooks** (interceptPaths, onIntercept, debug logging).

### Phase 2 — Server Helper (MCP Server Side)

1. **Provide a reference `http_request` tool**:
   - `visibility: ["app"]`
   - Switch on `{ method, path }` to call existing app logic
2. **Encourage reuse of existing functions** (same functions used by semantic model tools).

### Phase 3 — Host Routing (Optional)

1. **Default route**: Host forwards `http_request` via MCP (`tools/call`).
2. **Optional optimization**: Host can route `http_request` via HTTP if it already holds valid auth for the same service (token reuse rules apply).
3. **Keep postMessage as the only iframe→host channel**.

### Phase 4 — Demo Example (Proof of Flow)

Use `examples/basic-server-vanillajs`:

1. Add `initMcpFetch(app)` and replace `app.callServerTool("get-time")` with `fetch("/api/time")`.
2. Implement `http_request` in the server (switch on `/api/time`).
3. Add a WebMCP tool that calls the same function as the button click.

### Phase 5 — Docs + Spec Updates

1. **Document sandboxed flow** (postMessage → host → MCP → server).
2. **Explain dev vs host behavior** (native fetch in dev, wrapper in host).
3. **Clarify auth reuse constraints** (audience/issuer/scope).

### Phase 6 — Tests

1. E2E test: `fetch()` in iframe triggers `http_request`.
2. E2E test: model tool and user click hit the same function.
3. Regression test: native fetch still works in standalone dev mode.

## Status

- [x] Vision document complete
- [x] Current architecture documented
- [x] WebMCP overview documented
- [x] Proposed architecture documented
- [x] MCP fetch wrapper design complete
- [x] Code path analysis complete
- [x] Migration guide complete
- [x] Proof of concept plan complete
- [x] Complexity analysis complete
- [x] Counterarguments addressed
- [x] Edge cases documented
- [ ] PR comment drafted
- [ ] PoC implementation
- [ ] PR submitted
