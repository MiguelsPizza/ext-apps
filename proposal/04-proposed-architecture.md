# Proposed Architecture: WebMCP + MCP Fetch Wrapper

This document describes the proposed new architecture for MCP Apps.

## Core Principles

1. **Apps are normal web apps** — Standard HTML/CSS/JS, normal fetch calls
2. **WebMCP for tool exposure** — `navigator.modelContext.registerTool()` for model interactions
3. **MCP fetch wrapper** — `fetch()` becomes `callServerTool("http_request")`
4. **Same code path** — User clicks and model tool calls trigger identical logic

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              MCP App Host                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Host Application                          │    │
│  │                                                                  │    │
│  │   MCP Client ◄────────────────────────► MCP Server              │    │
│  │       │                                    (backend)             │    │
│  │       │                                                          │    │
│  │   AppBridge                                                      │    │
│  │       │                                                          │    │
│  │       ├── IframeParentTransport ◄──── WebMCP Tool Discovery/Calls│    │
│  │       │                                                          │    │
│  │       └── MCP tools/call forwarding (http_request)               │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                          postMessage                                     │
│                              │                                           │
│  ┌───────────────────────────▼─────────────────────────────────────┐    │
│  │                      Iframe (MCP App)                            │    │
│  │                                                                  │    │
│  │   ┌─────────────────────────────────────────────────────────┐   │    │
│  │   │                 Normal Web App                           │   │    │
│  │   │                                                          │   │    │
│  │   │   UI Components ──► Logic/State ──► fetch('/api/...')    │   │    │
│  │   │        ▲                                   │              │   │    │
│  │   │        │                                   ▼              │   │    │
│  │   │   User clicks                      Fetch Wrapper          │   │    │
│  │   │                                          │                │   │    │
│  │   └──────────────────────────────────────────┼────────────────┘   │    │
│  │                                              │                    │    │
│  │   ┌──────────────────────┐                   │                    │    │
│  │   │    WebMCP Tools      │                   │                    │    │
│  │   │                      │                   │                    │    │
│  │   │  navigator.model     │                   ▼                    │    │
│  │   │  Context.register    │         ┌─────────────────┐            │    │
│  │   │  Tool()              │         │ MCP Fetch       │            │    │
│  │   │                      │         │ Wrapper         │            │    │
│  │   │  Exposes UI actions  │         │                 │            │    │
│  │   │  to model            │         │ tools/call      │            │    │
│  │   └──────────────────────┘         └─────────────────┘            │    │
│  │           │                                │                      │    │
│  └───────────┼────────────────────────────────┼──────────────────────┘    │
│              │                                │                           │
│              ▼                                ▼                           │
│      IframeChildTransport              postMessage                       │
│      (tool discovery)                  (MCP tools/call)                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deployment Reality: Sandboxed by Default

Even when the UI and MCP server are owned by the same provider, hosts typically **rehost UI HTML** from `resources/read` into a **host-controlled sandbox origin**. That means:

- The iframe **is not** the MCP server origin
- Third‑party cookies are blocked or partitioned
- The iframe cannot directly call the MCP server with its own auth

This is the default security model for MCP Apps and the reason the fetch wrapper must route through the host.

If a host **explicitly** embeds external UI at its origin (opt‑in), direct fetch may work — but that’s a host policy choice and not the default.

## Transport Primitive vs Semantic Tools

The `http_request` tool is a **transport primitive**, not a semantic action. It exists to move requests across the host boundary with auditability and policy enforcement.

- **Model-facing semantics** → WebMCP tools (`navigator.modelContext`)
- **Backend transport** → `http_request` (app‑only)

This avoids per‑endpoint tool definitions while keeping full host observability.

## Two Communication Channels

### Channel 1: WebMCP Tools (Model ↔ App UI)

```typescript
// App registers UI-level tools
navigator.modelContext.registerTool({
  name: "click_add_to_cart",
  inputSchema: { itemId: { type: "string" } },
  handler: async ({ itemId }) => {
    // Calls same function as button click
    addToCart(itemId);
    return { success: true };
  },
});

// Host discovers via MCP client
const client = new Client({ name: "host", version: "1.0.0" });
await client.connect(new IframeParentTransport({ iframe }));
const { tools } = await client.listTools();

// Host (or model) calls tool
await client.callTool({
  name: "click_add_to_cart",
  arguments: { itemId: "123" },
});
```

### Channel 2: MCP Fetch Wrapper (App ↔ Server ↔ Backend)

```typescript
// App makes normal fetch calls
async function addToCart(itemId: string) {
  cart.push(itemId);

  // This fetch is intercepted and converted to MCP tools/call
  const res = await fetch("/api/cart", {
    method: "POST",
    body: JSON.stringify({ itemId }),
  });

  return res.json();
}

// Under the hood (MCP app context):
// app.callServerTool({ name: "http_request", arguments: { method, url, body } })
// MCP server executes http_request with OAuth credentials
```

## The App Developer Experience

### Writing an MCP App

```typescript
// main.tsx - Entry point
import "@mcp-b/global";  // WebMCP polyfill
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

const mcpApp = new App({ name: "MyApp", version: "1.0.0" });

// Initialize MCP fetch wrapper (converts fetch -> tools/call)
initMcpFetch(mcpApp, { interceptPaths: ['/api/'] });

await mcpApp.connect(new PostMessageTransport(window.parent));

// Normal React app
ReactDOM.render(<App />, document.getElementById("root"));
```

```typescript
// App.tsx - Normal React component
import { useWebMCP } from "@mcp-b/react-webmcp";

function App() {
  const [cart, setCart] = useState<Item[]>([]);

  // Normal application logic
  async function addToCart(item: Item) {
    setCart(prev => [...prev, item]);

    // Normal fetch - transparently converted to tools/call
    await fetch('/api/cart', {
      method: 'POST',
      body: JSON.stringify({ itemId: item.id })
    });
  }

  // WebMCP tool - thin wrapper around same logic
  useWebMCP({
    name: "add_to_cart",
    description: "Add an item to the shopping cart",
    inputSchema: { itemId: z.string() },
    handler: async ({ itemId }) => {
      const item = products.find(p => p.id === itemId);
      if (item) await addToCart(item);
      return { success: true, cartSize: cart.length + 1 };
    },
    deps: [cart]
  });

  useWebMCP({
    name: "get_cart",
    description: "Get current cart contents",
    handler: async () => ({
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price })),
      total: cart.reduce((sum, i) => sum + i.price, 0)
    }),
    deps: [cart]
  });

  return (
    <div>
      {products.map(product => (
        <button key={product.id} onClick={() => addToCart(product)}>
          Add {product.name}
        </button>
      ))}
      <Cart items={cart} />
    </div>
  );
}
```

### Key Points

1. **`App` is minimal** — Used for UI protocol + MCP fetch wrapper only
2. **No `app.registerTool()`** — Use `useWebMCP()` hook
3. **No direct `app.callServerTool()`** — App logic uses normal `fetch()`
4. **Same code path** — Button click and tool call both use `addToCart()`

## What Changes in ext-apps

### Remove (or deprecate)

- `App.registerTool()` method
- `App.oncalltool` handler
- `App.onlisttools` handler
- `App.sendToolListChanged()` method
- `AppBridge.callTool()` method (hosts should use MCP client + IframeParentTransport)
- `AppBridge.listTools()` method (hosts should use MCP client + IframeParentTransport)
- All tool-related types and schemas

### Add

- MCP fetch wrapper (`fetch()` → `callServerTool("http_request")`)
- Standard `http_request` tool contract (app-only)
- Documentation for WebMCP + MCP fetch wrapper pattern
- Example showing WebMCP + MCP fetch wrapper pattern

### Keep

- UI resources (`ui://` scheme)
- CSP declarations
- Theming (style variables)
- Display modes (inline, fullscreen, pip)
- Container dimensions
- Host context communication
- Auto-resize functionality
- `App.callServerTool()` (used internally by MCP fetch wrapper)
- PostMessageTransport (for non-tool communication)

## Host Implementation

### Current (PR #72)

```typescript
// Custom tool methods
const bridge = new AppBridge(iframe, mcpClient);

bridge.oncalltool = async (params) => { ... };
bridge.onlisttools = async () => { ... };

const tools = await bridge.listTools();
const result = await bridge.callTool({ name: "...", arguments: {} });
```

### Proposed

```typescript
// Standard MCP client for tools
const toolClient = new Client({ name: "widget-tools", version: "1.0.0" });
await toolClient.connect(new IframeParentTransport({ iframe }));

// Tool discovery via standard MCP
const { tools } = await toolClient.listTools();
const result = await toolClient.callTool({ name: "...", arguments: {} });

// MCP server provides http_request tool (visibility: ["app"]) and handles auth

// AppBridge for non-tool communication
const bridge = new AppBridge(iframe, mcpClient);
bridge.sendToolInput(toolInput);
bridge.onsizechange = ({ width, height }) => { ... };
```

## Observability & Policy (Host Responsibilities)

Even with a single `http_request` transport tool, hosts can enforce:

- Path/method allowlists
- Rate limits and quotas
- User confirmation for destructive operations
- Audit logging (method, path, size, timing)

This keeps the host in control without requiring per‑endpoint tool definitions.

## Flow Diagrams

### User Interaction Flow

```
User clicks "Add to Cart" button
    │
    ▼
onClick={() => addToCart(item)}
    │
    ▼
addToCart(item) {
  setCart([...cart, item]);
  fetch('/api/cart', { method: 'POST', body: {...} });
}
    │
    ▼
Fetch wrapper captures request
    │
    ▼
app.callServerTool("http_request", { method, url, body })
    │
    ▼
Host forwards tools/call to MCP server
    │
    ▼
MCP server executes http_request with OAuth credentials
    │
    ▼
Response returned through MCP
    │
    ▼
Fetch wrapper resolves Response, updates UI
```

### Model Interaction Flow

```
Model calls tool: { name: "add_to_cart", arguments: { itemId: "123" } }
    │
    ▼
Host's MCP client sends tools/call via IframeParentTransport
    │
    ▼
WebMCP in iframe receives call, dispatches to handler
    │
    ▼
handler: async ({ itemId }) => {
  const item = products.find(p => p.id === itemId);
  await addToCart(item);  // Same function as button!
  return { success: true };
}
    │
    ▼
addToCart(item) {
  setCart([...cart, item]);
  fetch('/api/cart', { method: 'POST', body: {...} });
}
    │
    ▼
[Same MCP fetch wrapper flow as user interaction]
    │
    ▼
Tool result returned to model
```

**Both flows call the same `addToCart()` function.** Same logic, same behavior, same bugs, same fixes.

## Transport Multiplexing (Open Issue)

WebMCP tool calls and MCP Apps UI messages both use JSON‑RPC over `postMessage`. We need a standardized way to avoid collisions, e.g.:

- Channel tagging (`{ channel: "webmcp" | "ui" }`)
- Dedicated `MessagePort` per channel
- A shared mux transport in ext‑apps

## Capability Negotiation

### App Capabilities

```typescript
// Declare in initialization
{
  appCapabilities: {
    // WebMCP handles tool capabilities
    // App just registers tools via navigator.modelContext

    // Other capabilities remain
    availableDisplayModes: ["inline", "fullscreen"],
    // ...
  }
}
```

### Host Capabilities

```typescript
{
  hostCapabilities: {
    // Host supports app->server tools/call (used by MCP fetch wrapper)
    serverTools: { listChanged: true },
    displayModes: ["inline", "fullscreen", "pip"],
    // ...
  }
}
```

## Benefits Recap

| Aspect                | Current (PR #72)       | Proposed                                |
| --------------------- | ---------------------- | --------------------------------------- |
| **Tool registration** | `app.registerTool()`   | `navigator.modelContext.registerTool()` |
| **Tool access**       | Pass `app` instance    | Global API                              |
| **Backend calls**     | `app.callServerTool()` | Normal `fetch()` (wrapped to MCP)       |
| **Code paths**        | Separate for UI/model  | Same                                    |
| **App portability**   | MCP-app specific       | Works anywhere                          |
| **Library support**   | Needs `app` param      | Just works                              |
| **Standards**         | Custom                 | W3C trajectory                          |
| **React ergonomics**  | Prop drilling          | Just use hook                           |
