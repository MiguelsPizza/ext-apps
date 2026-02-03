# WebMCP: Web Model Context API

WebMCP is an emerging web standard that enables web applications to expose tools, resources, and prompts to AI agents through a unified API.

## The Standard

### navigator.modelContext

The core API is `navigator.modelContext`, similar to other Navigator APIs like `navigator.geolocation`:

```typescript
// Register a tool
const unregister = navigator.modelContext.registerTool({
  name: "add_to_cart",
  description: "Add an item to the shopping cart",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string" },
    },
    required: ["itemId"],
  },
  handler: async ({ itemId }) => {
    cart.push(itemId);
    return { success: true, cartSize: cart.length };
  },
});

// Later: unregister
unregister();
```

### Key Characteristics

1. **Global API** — Available everywhere, no instance passing
2. **Standard interface** — Follows Web API conventions
3. **Async handlers** — Tool handlers are async functions
4. **Lifecycle management** — Returns unregister function
5. **Schema-based** — JSON Schema for input/output validation

## Polyfill: @mcp-b/global

The WebMCP polyfill provides `navigator.modelContext` in browsers that don't have native support:

```typescript
import "@mcp-b/global";  // Installs polyfill

// Now available globally
navigator.modelContext.registerTool({ ... });
```

### Polyfill Architecture

```
navigator.modelContext (Web API)
    │
    ▼
WebModelContext (polyfill implementation)
    │
    ▼
MCPBridge (broker)
    │
    ├── TabServer (MCP server for same-window clients)
    │
    └── IframeServer (MCP server for parent page)
```

### Two-Bucket Tool Registration

The polyfill maintains two tool registries:

**Bucket A: Base Tools** (`provideContext()`)

```typescript
navigator.modelContext.provideContext({
  tools: [
    { name: "tool1", handler: ... },
    { name: "tool2", handler: ... }
  ]
});
// Replaces all base tools when called again
```

**Bucket B: Dynamic Tools** (`registerTool()`)

```typescript
const unregister = navigator.modelContext.registerTool({
  name: "component_tool",
  handler: ...
});
// Persists across provideContext() calls
// Perfect for React component lifecycle
```

Both buckets merge into a single tool list for MCP clients.

## React Integration: @mcp-b/react-webmcp

### useWebMCP Hook

```typescript
import { useWebMCP } from "@mcp-b/react-webmcp";

function ShoppingCart() {
  const [cart, setCart] = useState<string[]>([]);

  useWebMCP({
    name: "add_to_cart",
    description: "Add item to cart",
    inputSchema: {
      itemId: z.string()
    },
    handler: async ({ itemId }) => {
      setCart(prev => [...prev, itemId]);
      return { success: true };
    },
    deps: []  // Re-register when deps change
  });

  useWebMCP({
    name: "get_cart_contents",
    handler: async () => ({ items: cart }),
    deps: [cart]  // Re-register when cart changes
  });

  return <div>...</div>;
}
```

### Hook Features

- **Automatic lifecycle** — Registers on mount, unregisters on unmount
- **Dependency tracking** — Re-registers when deps change
- **Zod schemas** — Type-safe input validation
- **State tracking** — Returns `{ isExecuting, lastResult, error }`

## Transport Layer: @mcp-b/transports

### IframeTransports

For parent-child iframe communication:

```typescript
// Parent page (host)
import { IframeParentTransport } from "@mcp-b/transports";
import { Client } from "@anthropic/sdk/mcp";

const client = new Client({ name: "host", version: "1.0.0" });
const transport = new IframeParentTransport({
  iframe: document.getElementById("app-iframe"),
  targetOrigin: "https://app.example.com",
});

await client.connect(transport);
const { tools } = await client.listTools();
```

```typescript
// Iframe (app)
import { IframeChildTransport } from "@mcp-b/transports";

// Polyfill uses this internally to expose tools to parent
initializeWebModelContext({
  transport: {
    iframeServer: {
      allowedOrigins: ["https://host.example.com"],
    },
  },
});
```

### TabTransports

For same-window communication (e.g., browser extension to page):

```typescript
// Extension content script
import { TabClientTransport } from "@mcp-b/transports";

const client = new Client({ name: "extension", version: "1.0.0" });
await client.connect(new TabClientTransport({ targetOrigin: "*" }));
```

```typescript
// Page
import { TabServerTransport } from "@mcp-b/transports";

// Polyfill sets this up automatically
initializeWebModelContext({
  transport: {
    tabServer: { allowedOrigins: ["*"] },
  },
});
```

## Native Browser Support

Chromium is implementing `navigator.modelContext` natively:

```typescript
// Detection
if ("modelContext" in navigator) {
  // Check if native or polyfill
  const isPolyfill = (navigator.modelContext as any).__isWebMCPPolyfill;
}
```

### Native Adapter

The polyfill includes a `NativeModelContextAdapter` that:

1. Detects native `navigator.modelContext`
2. Wraps it to provide consistent API
3. Syncs native tools to MCP bridge
4. Falls back to full polyfill if native unavailable

When native ships, the polyfill becomes a no-op for most functionality.

## Notification Batching

Multiple tool registrations in the same microtask are batched:

```typescript
// These happen in one React render
useWebMCP({ name: "tool1", ... });
useWebMCP({ name: "tool2", ... });
useWebMCP({ name: "tool3", ... });

// Only ONE notifications/tools/list_changed sent
```

This prevents notification spam during component mount cycles.

## Testing API

```typescript
// Available via navigator.modelContextTesting
navigator.modelContextTesting.setMockToolResponse("my_tool", {
  content: [{ type: "text", text: "Mocked!" }]
});

await triggerAction();

const calls = navigator.modelContextTesting.getToolCalls();
expect(calls).toContainEqual({ name: "my_tool", arguments: { ... } });

navigator.modelContextTesting.reset();
```

## Comparison: WebMCP vs ext-apps registerTool

| Aspect                    | WebMCP                                  | ext-apps                    |
| ------------------------- | --------------------------------------- | --------------------------- |
| **API**                   | `navigator.modelContext.registerTool()` | `app.registerTool()`        |
| **Access**                | Global                                  | Instance-based              |
| **React**                 | `useWebMCP()` hook                      | Pass `app` as prop          |
| **Lifecycle**             | Returns unregister function             | `tool.remove()`             |
| **Enable/disable**        | Re-register or not                      | `tool.enable()`/`disable()` |
| **Notification batching** | Built-in (microtask)                    | Manual                      |
| **Testing**               | `navigator.modelContextTesting`         | None built-in               |
| **Native support**        | Chromium implementing                   | No                          |
| **Standalone use**        | Works on any website                    | MCP apps only               |

## Packages Summary

| Package                  | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `@mcp-b/global`          | Core polyfill, installs `navigator.modelContext`   |
| `@mcp-b/react-webmcp`    | React hooks (`useWebMCP`)                          |
| `@mcp-b/transports`      | Transport implementations (Iframe, Tab, Extension) |
| `@mcp-b/webmcp-ts-sdk`   | Browser-adapted MCP SDK                            |
| `@mcp-b/extension-tools` | Pre-built Chrome Extension tools                   |

## Using WebMCP in MCP Apps

For MCP Apps to use WebMCP instead of `app.registerTool()`:

```typescript
// Instead of:
const app = new App({ name: "App", version: "1.0" }, { tools: { listChanged: true } });
app.registerTool("my_tool", { ... }, handler);

// Use:
import "@mcp-b/global";

navigator.modelContext.registerTool({
  name: "my_tool",
  description: "...",
  inputSchema: { ... },
  handler: async (args) => { ... }
});
```

The host (AppBridge) would use an MCP client with `IframeParentTransport` to discover and call these tools, instead of custom `bridge.listTools()` / `bridge.callTool()` methods.
