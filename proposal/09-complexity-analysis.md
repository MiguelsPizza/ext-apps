# Complexity Analysis: Current Model vs. Proposed

This document analyzes the friction introduced by PR #72's approach for REST-backed web apps, and how the WebMCP + MCP fetch wrapper reduces that friction while preserving MCP's strengths.

## What the Current Spec Gets Right

The current MCP Apps model is **deliberate and security-first**:

1. **Tool-first semantics** — Everything is explicit MCP tools, so hosts can audit, gate, and reason about actions. That's a feature, not a bug.
2. **No HTTP assumptions** — It works with any backend or service logic, not just REST/GraphQL. It's transport-agnostic.
3. **Security boundaries are clear** — Apps are sandboxed UIs; the host/server remain the trusted execution boundary.
4. **It already avoids cookies** — It doesn't rely on browser cookies or a host HTTP proxy.

**The current model can do everything our proposal does — it's just more manual.**

## Where the Current Spec is Costly

For developers porting existing web apps with REST backends:

1. **Web-app porting friction** — You can't just drop in existing fetch-based UI code; you have to wrap backend calls as server tools
2. **Per-endpoint tool definitions** — Every REST endpoint needs a corresponding server tool
3. **Duplicated code paths** — UI actions and model actions often require parallel wiring
4. **App tools can become wrappers** — For common REST-backed actions, you end up with "tool → tool" patterns

These points are fair **without implying the spec is wrong**.

## What Our Proposal Changes

It **doesn't replace the spec** — it adds:

1. A standard `http_request` tool + fetch wrapper as a **convenience layer**
2. WebMCP for tool registration (emerging web standard)

It keeps everything in `tools/call`, which is consistent with MCP's audit model.

It does introduce new obligations:
- Standard `http_request` contract
- Transport multiplexing for two JSON-RPC streams
- Optional notification extensions for WS/SSE/streaming

## Tracing a Single Action: Current Model

**Scenario:** Model wants to add an item to a shopping cart. This requires:
1. Updating local UI state
2. Making an HTTP call to the backend API

### Step-by-Step Flow (App Tool + Server Tool Pattern)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL                                                                        │
│                                                                              │
│  "Call tool: app_add_to_cart with { itemId: '123' }"                         │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (1) Model → Host
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  bridge.callTool({ name: "add_to_cart", arguments: { itemId: "123" } })      │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (2) postMessage DOWN to iframe
┌─────────────────────────────────────────────────────────────────────────────┐
│ APP (iframe)                                                                 │
│                                                                              │
│  oncalltool receives: { name: "add_to_cart", arguments: { itemId: "123" } }  │
│                                                                              │
│  Tool handler executes:                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ async ({ itemId }) => {                                              │    │
│  │   // App tool MUST call server tool for backend action               │    │
│  │   const result = await app.callServerTool("cart_add", { itemId });   │    │
│  │   return result;                                                     │    │
│  │ }                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (3) postMessage UP to host (callServerTool)
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Receives server tool call request from app                                  │
│  Proxies to MCP client                                                       │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (4) MCP protocol to server
┌─────────────────────────────────────────────────────────────────────────────┐
│ MCP SERVER                                                                   │
│                                                                              │
│  Executes "cart_add" tool                                                    │
│  Modifies database                                                           │
│  Returns result                                                              │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (5) MCP response to host
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Receives server tool result                                                 │
│  Must forward to app                                                         │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (6) postMessage DOWN to iframe (result)
┌─────────────────────────────────────────────────────────────────────────────┐
│ APP (iframe)                                                                 │
│                                                                              │
│  Receives server tool result                                                 │
│  Tool handler continues, returns                                             │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (7) postMessage UP to host (tool result)
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Receives app tool result                                                    │
│  Returns to model                                                            │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (8) Result to model
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL                                                                        │
│                                                                              │
│  Receives: { content: [{ type: "text", text: "Added to cart" }] }            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Count the Hops

| Hop | Direction | Transport |
|-----|-----------|-----------|
| 1 | Model → Host | Internal |
| 2 | Host → App | postMessage |
| 3 | App → Host | postMessage |
| 4 | Host → Server | MCP/HTTP |
| 5 | Server → Host | MCP/HTTP |
| 6 | Host → App | postMessage |
| 7 | App → Host | postMessage |
| 8 | Host → Model | Internal |

**Total: 8 hops, 4 postMessage round trips**

### The Boilerplate (Backend Communication Pattern)

```typescript
// SERVER: Must define a tool for each backend operation
server.registerTool("cart_add", {
  inputSchema: z.object({ itemId: z.string() })
}, async ({ itemId }) => {
  await db.cart.add(itemId);
  return { content: [{ type: "text", text: "Added" }] };
});

// APP: Needs to call the server tool somehow
// Option A: App tool that wraps server tool
app.registerTool("add_to_cart", {
  inputSchema: z.object({ itemId: z.string() })
}, async ({ itemId }) => {
  cart.push(itemId);  // Update local state
  const result = await app.callServerTool("cart_add", { itemId });  // Backend call
  return result;
});

// Option B: Call server tool directly from event handler
async function handleAddToCart(itemId) {
  cart.push(itemId);
  await app.callServerTool("cart_add", { itemId });
}
```

**The key issue:** Every backend endpoint needs a server tool definition. You can't just use `fetch('/api/cart')`.

**Note:** UI-control tools (like map's `navigate-to`) are different — they don't wrap server tools and are legitimate in both architectures.

## Tracing the Same Action: Proposed Model

**Same scenario:** Model wants to add an item to a shopping cart.

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL                                                                        │
│                                                                              │
│  "Call tool: add_to_cart with { itemId: '123' }"                             │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (1) Model → Host
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  mcpClient.callTool({ name: "add_to_cart", arguments: { itemId: "123" } })   │
│  (via IframeParentTransport)                                                 │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (2) postMessage to iframe (WebMCP)
┌─────────────────────────────────────────────────────────────────────────────┐
│ APP (iframe)                                                                 │
│                                                                              │
│  WebMCP receives tool call, dispatches to handler                            │
│                                                                              │
│  Handler executes NORMAL APP LOGIC:                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ async ({ itemId }) => {                                              │    │
│  │   cart.push(itemId);                                                 │    │
│  │   await fetch('/api/cart', {                                         │    │
│  │     method: 'POST',                                                  │    │
│  │     body: JSON.stringify({ itemId })                                 │    │
│  │   });                                                                │    │
│  │   return { success: true };                                          │    │
│  │ }                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  fetch() wrapped into http_request tools/call                                 │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (3) postMessage UP (http_request tools/call)
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Forwards tools/call to MCP server                                           │
│  Server executes http_request + HTTP call                                   │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (4) HTTP to backend
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKEND (regular REST API)                                                   │
│                                                                              │
│  POST /api/cart { itemId: "123" }                                            │
│  Adds to database                                                            │
│  Returns { success: true }                                                   │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (5) HTTP response to host
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Forwards MCP response to iframe                                             │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (6) postMessage DOWN (tools/call response)
┌─────────────────────────────────────────────────────────────────────────────┐
│ APP (iframe)                                                                 │
│                                                                              │
│  fetch() resolves                                                            │
│  Tool handler returns { success: true }                                      │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (7) postMessage UP (tool result via WebMCP)
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOST                                                                         │
│                                                                              │
│  Returns tool result to model                                                │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼ (8) Result to model
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL                                                                        │
│                                                                              │
│  Receives: { success: true }                                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Count the Hops

| Hop | Direction | Transport |
|-----|-----------|-----------|
| 1 | Model → Host | Internal |
| 2 | Host → App | postMessage (tool call) |
| 3 | App → Host | postMessage (http_request tools/call) |
| 4 | Host → Backend | HTTP |
| 5 | Backend → Host | HTTP |
| 6 | Host → App | postMessage (fetch response) |
| 7 | App → Host | postMessage (tool result) |
| 8 | Host → Model | Internal |

**Total: 8 hops**

### Same Hops, Different Developer Experience

The hop count is similar in both models — that's not the issue. **The issue is what developers must define and understand.**

**Current model requires:**
1. Server tool definitions for each backend endpoint
2. `app.callServerTool()` calls in app code
3. Understanding when to use server tools vs app tools

**Proposed model requires:**
1. Normal `fetch()` calls (wrapper handles conversion)
2. One generic `http_request` server tool (infrastructure, not per-endpoint)

### The Real Savings: No Per-Endpoint Server Tools

**Current model:**
```
Developer: "I need to call /api/cart"
Steps:
1. Define server.registerTool("cart_add", ...)
2. Call app.callServerTool("cart_add", ...)
3. Repeat for every endpoint
```

**Proposed model:**
```
Developer: "I need to call /api/cart"
Steps:
1. Write fetch('/api/cart', ...) — done
```

## The Boilerplate Comparison

### Current: Every Backend Endpoint Needs a Server Tool

```typescript
// === SERVER: Define tools for each backend operation ===
server.registerTool("cart_add", schema, async ({ itemId }) => {
  await db.cart.add(itemId);
  return { content: [{ type: "text", text: "Added" }] };
});

server.registerTool("cart_remove", schema, async ({ itemId }) => {
  await db.cart.remove(itemId);
  return { content: [{ type: "text", text: "Removed" }] };
});

server.registerTool("cart_clear", schema, async () => {
  await db.cart.clear();
  return { content: [{ type: "text", text: "Cleared" }] };
});

// === APP: Call server tools for backend operations ===
async function addToCart(itemId) {
  cart.push(itemId);
  await app.callServerTool("cart_add", { itemId });
}

async function removeFromCart(itemId) {
  cart = cart.filter(i => i !== itemId);
  await app.callServerTool("cart_remove", { itemId });
}

async function clearCart() {
  cart = [];
  await app.callServerTool("cart_clear", {});
}

// === APP: Register tools for model interaction (legitimate) ===
app.registerTool("add_to_cart", schema, async ({ itemId }) => {
  await addToCart(itemId);
  return { success: true };
});
// ... etc
```

**Every backend endpoint needs a server tool definition.** You can't just use REST APIs.

### Proposed: Normal Fetch + Generic http_request Tool

```typescript
// === SERVER: One generic http_request tool (visibility: ["app"]) ===
server.registerTool("http_request", {
  inputSchema: z.object({ method: z.string(), url: z.string(), body: z.any().optional() }),
  _meta: { ui: { visibility: ["app"] } }  // Model can't call this directly
}, async ({ method, url, body }) => {
  // Makes authenticated HTTP request to backend
  return fetch(baseUrl + url, { method, body, headers: authHeaders });
});

// === BACKEND (normal REST API - no MCP awareness needed) ===
app.post('/api/cart', async (req, res) => {
  await db.cart.add(req.body.itemId);
  res.json({ success: true });
});
// ... standard REST endpoints

// === APP: Normal functions using fetch ===
async function addToCart(itemId) {
  cart.push(itemId);
  // fetch() is intercepted by MCP fetch wrapper → callServerTool("http_request")
  await fetch('/api/cart', { method: 'POST', body: JSON.stringify({ itemId }) });
}

async function removeFromCart(itemId) {
  cart = cart.filter(i => i !== itemId);
  await fetch(`/api/cart/${itemId}`, { method: 'DELETE' });
}

// === APP: WebMCP tools for model interaction ===
navigator.modelContext.registerTool({
  name: "add_to_cart",
  handler: ({ itemId }) => addToCart(itemId)  // Same function as button click!
});

navigator.modelContext.registerTool({
  name: "remove_from_cart",
  handler: ({ itemId }) => removeFromCart(itemId)
});

// UI uses the same functions!
<button onClick={() => addToCart(item.id)}>Add</button>
```

**Key differences:**
- **No server tool per endpoint** — One generic `http_request` tool handles all HTTP communication
- **Normal REST backend** — Backend doesn't need MCP-specific tool definitions
- **Standard fetch()** — Developers write normal code, wrapper handles MCP conversion
- **Same code path** — UI clicks and model calls use identical functions

## The Interaction Model Problem

### Current: Multiple Concepts for Developers

Developers must understand:

1. **Server tools** — Defined on MCP server, called via `app.callServerTool()`
2. **App tools** — Defined on app via `app.registerTool()`, called by model
3. **When to use which** — Backend operations need server tools, UI control needs app tools
4. **The relationship** — App tools can call server tools, creating layered patterns

**Mental overhead:** "Do I define this as a server tool or an app tool? If the model needs to trigger this, I need an app tool. If it touches the backend, I need a server tool. If both, I need both."

### Proposed: Clearer Separation

Developers understand:

1. **WebMCP tools** — Things the model can do (UI-level actions)
2. **fetch()** — Backend communication (transparently handled)

```
Developer thinks:
- "Model needs to add to cart" → WebMCP tool that calls addToCart()
- "Need to save to database" → fetch('/api/cart') (just works)
```

**Backend is an implementation detail, not a separate tool layer.**

## Summary

| Aspect | Current Model | Proposed Model |
|--------|---------------|----------------|
| **Tool registration** | `app.registerTool()` | WebMCP (`navigator.modelContext`) |
| **Backend calls** | Define server tool per endpoint | Generic `http_request` + fetch wrapper |
| **Server tool definitions** | One per backend operation | One generic tool |
| **Code paths** | Can differ for UI/model | Same by design |
| **Cognitive load** | Server tools + app tools | WebMCP tools + fetch |
| **Portability** | MCP-app specific | Works anywhere (via WebMCP polyfill) |
| **UI control tools** | `app.registerTool()` | WebMCP (equivalent) |

## The Bottom Line

**Current model:** For backend communication, developers must define server tools for each operation. Apps call these via `app.callServerTool()`. For UI control, apps register tools via `app.registerTool()`. This creates multiple concepts: server tools, app tools, and their relationships.

**Proposed model:** Developers write normal web apps using `fetch()` for backend communication (wrapper handles MCP conversion). For UI control, they register WebMCP tools that wrap application logic. Both user clicks and model calls invoke the same functions. Backend communication is an implementation detail, not a separate tool layer.

**Key insight:** We're not eliminating the hops (MCP is still involved). We're eliminating the cognitive overhead of defining server tools for every backend endpoint and choosing between server tools vs app tools.
