# Migration Guide: From Current to WebMCP Architecture

This guide shows how to migrate existing MCP Apps from the current architecture (PR #72 style) to the proposed WebMCP + MCP fetch wrapper architecture.

## Quick Reference

| Current Pattern                               | New Pattern                                                         |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `app.registerTool(name, config, handler)`     | `navigator.modelContext.registerTool({ name, ...config, handler })` |
| `app.callServerTool(params)`                  | `fetch('/api/endpoint')` (proxied)                                  |
| `useApp({ onAppCreated: (app) => ... })`      | `useWebMCP({ ... })`                                                |
| Pass `app` as props                           | No props needed (global API)                                        |
| `{ tools: { listChanged: true } }` capability | Not needed (WebMCP handles)                                         |

## Step-by-Step Migration

### Step 1: Add Dependencies

```bash
npm install @mcp-b/global @mcp-b/react-webmcp
```

Or if ext-apps bundles simplified versions:

```bash
npm install @modelcontextprotocol/ext-apps@latest
```

### Step 2: Initialize WebMCP and MCP Fetch Wrapper

**Before:**

```typescript
// main.tsx
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "MyApp", version: "1.0" },
  { tools: { listChanged: true } },
);

await app.connect(new PostMessageTransport(window.parent));
```

**After:**

```typescript
// main.tsx
import "@mcp-b/global";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

const app = new App({ name: "MyApp", version: "1.0" });
initMcpFetch(app, { interceptPaths: ["/api/"] });
await app.connect(new PostMessageTransport(window.parent));

// WebMCP is now globally available via navigator.modelContext
// No explicit connection needed - polyfill handles transport
```

**Server requirement:** The MCP server must expose an app-only `http_request` tool (visibility `["app"]`) that performs authenticated HTTP calls.

### Step 3: Migrate Tool Registration (Vanilla JS)

**Before:**

```typescript
const app = new App(
  { name: "Shop", version: "1.0" },
  { tools: { listChanged: true } },
);

app.registerTool(
  "get_cart",
  {
    description: "Get current cart contents",
    outputSchema: z.object({
      items: z.array(z.object({ id: z.string(), name: z.string() })),
      total: z.number(),
    }),
  },
  async () => ({
    content: [{ type: "text", text: `Cart has ${cart.length} items` }],
    structuredContent: {
      items: cart.map((i) => ({ id: i.id, name: i.name })),
      total: cart.reduce((sum, i) => sum + i.price, 0),
    },
  }),
);

app.registerTool(
  "add_to_cart",
  {
    description: "Add item to cart",
    inputSchema: z.object({ itemId: z.string() }),
    annotations: { readOnlyHint: false },
  },
  async ({ itemId }) => {
    const item = products.find((p) => p.id === itemId);
    if (!item) {
      return {
        content: [{ type: "text", text: "Item not found" }],
        isError: true,
      };
    }
    cart.push(item);
    return { content: [{ type: "text", text: `Added ${item.name}` }] };
  },
);

await app.connect();
```

**After:**

```typescript
import "@mcp-b/global";

navigator.modelContext.registerTool({
  name: "get_cart",
  description: "Get current cart contents",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: async () => ({
    items: cart.map((i) => ({ id: i.id, name: i.name })),
    total: cart.reduce((sum, i) => sum + i.price, 0),
  }),
});

navigator.modelContext.registerTool({
  name: "add_to_cart",
  description: "Add item to cart",
  inputSchema: {
    type: "object",
    properties: { itemId: { type: "string" } },
    required: ["itemId"],
  },
  handler: async ({ itemId }) => {
    const item = products.find((p) => p.id === itemId);
    if (!item) throw new Error("Item not found");

    cart.push(item);
    return { success: true, message: `Added ${item.name}` };
  },
});
```

### Step 4: Migrate Tool Registration (React)

**Before:**

```typescript
function MyApp() {
  const [cart, setCart] = useState<Item[]>([]);

  const { app, isConnected } = useApp({
    appInfo: { name: "Shop", version: "1.0" },
    capabilities: { tools: { listChanged: true } },
    onAppCreated: (app) => {
      app.registerTool("get_cart", { ... }, async () => ({ ... }));
      app.registerTool("add_to_cart", { ... }, async ({ itemId }) => { ... });
    }
  });

  if (!isConnected) return <Loading />;

  return <ShopUI app={app} cart={cart} setCart={setCart} />;
}

// Child needs app prop
function ShopUI({ app, cart, setCart }: { app: App, ... }) {
  const handleAdd = async (itemId: string) => {
    // Use app to call server
    await app.callServerTool({ name: "inventory_check", arguments: { itemId } });
    setCart([...cart, item]);
  };

  return <button onClick={() => handleAdd("123")}>Add</button>;
}
```

**After:**

```typescript
import { useWebMCP } from "@mcp-b/react-webmcp";

function MyApp() {
  const [cart, setCart] = useState<Item[]>([]);

  // Tools registered inline, no prop drilling needed
  useWebMCP({
    name: "get_cart",
    description: "Get current cart contents",
    handler: async () => ({
      items: cart.map(i => ({ id: i.id, name: i.name })),
      total: cart.reduce((sum, i) => sum + i.price, 0)
    }),
    deps: [cart]  // Re-register when cart changes
  });

  useWebMCP({
    name: "add_to_cart",
    description: "Add item to cart",
    inputSchema: { itemId: z.string() },
    handler: async ({ itemId }) => {
      const item = products.find(p => p.id === itemId);
      if (item) setCart(prev => [...prev, item]);
      return { success: !!item };
    },
    deps: []
  });

  return <ShopUI cart={cart} setCart={setCart} />;
}

// Child doesn't need app prop!
function ShopUI({ cart, setCart }: { cart: Item[], ... }) {
  const handleAdd = async (itemId: string) => {
    // Normal fetch, proxied automatically
    await fetch('/api/inventory/check', {
      method: 'POST',
      body: JSON.stringify({ itemId })
    });
    const item = products.find(p => p.id === itemId);
    if (item) setCart([...cart, item]);
  };

  return <button onClick={() => handleAdd("123")}>Add</button>;
}
```

### Step 5: Migrate Server Tool Calls to Fetch

**Before:**

```typescript
// Every backend call was an MCP tool call
async function loadUserData() {
  const result = await app.callServerTool({
    name: "get_user_profile",
    arguments: { userId: currentUserId },
  });
  return result.structuredContent;
}

async function saveSettings(settings: Settings) {
  await app.callServerTool({
    name: "update_settings",
    arguments: { userId: currentUserId, settings },
  });
}
```

**After:**

```typescript
// Normal fetch calls, proxied through host
async function loadUserData() {
  const response = await fetch(`/api/users/${currentUserId}/profile`);
  return response.json();
}

async function saveSettings(settings: Settings) {
  await fetch(`/api/users/${currentUserId}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}
```

### Step 6: Update Tool Lifecycle Management

**Before:**

```typescript
const tool = app.registerTool("my_tool", config, handler);

// Later: disable
tool.disable();

// Later: re-enable
tool.enable();

// Later: update
tool.update({ description: "New description" });

// Later: remove
tool.remove();
```

**After:**

```typescript
// Registration returns unregister function
const unregister = navigator.modelContext.registerTool({
  name: "my_tool",
  ...config,
  handler,
});

// Later: remove (no disable/enable, just unregister and re-register)
unregister();

// To "disable": unregister and don't re-register
// To "update": unregister and register with new config
// To "enable": register again

// With React hook, this is automatic based on deps
useWebMCP({
  name: "my_tool",
  handler: isEnabled ? handler : null, // Or conditionally render
  deps: [isEnabled],
});
```

### Step 7: Migrate Capability Declarations

**Before:**

```typescript
const app = new App(
  { name: "App", version: "1.0" },
  {
    tools: { listChanged: true }, // For registering tools
    serverTools: { listChanged: true }, // For calling server tools
  },
);
```

**After:**

```typescript
// No capability declaration needed for tools
// WebMCP handles tool notifications automatically

// If you still need other capabilities (display modes, etc.):
// Use ext-apps SDK for those specific features
```

## Common Patterns

### Pattern: Conditional Tool Registration

**Before:**

```typescript
if (user.isAdmin) {
  app.registerTool("admin_action", { ... }, handler);
}
```

**After:**

```typescript
// Option 1: Conditional hook (React)
function AdminTools({ user }) {
  useWebMCP({
    name: "admin_action",
    handler: user.isAdmin ? handler : undefined,
    deps: [user.isAdmin],
  });
}

// Option 2: Conditional registration (vanilla)
if (user.isAdmin) {
  navigator.modelContext.registerTool({
    name: "admin_action",
    handler,
  });
}
```

### Pattern: Tool with Cleanup

**Before:**

```typescript
const tool = app.registerTool("realtime_data", { ... }, handler);

// On cleanup
window.addEventListener('beforeunload', () => {
  tool.remove();
});
```

**After:**

```typescript
const unregister = navigator.modelContext.registerTool({
  name: "realtime_data",
  handler,
});

window.addEventListener("beforeunload", unregister);

// With React, automatic:
useWebMCP({
  name: "realtime_data",
  handler,
  deps: [],
});
// Unregisters automatically on unmount
```

### Pattern: Dynamic Tool List

**Before:**

```typescript
// Tools registered in onAppCreated, static

// Dynamic additions required:
const newTool = app.registerTool("dynamic_tool", { ... }, handler);
```

**After:**

```typescript
// Tools can be registered anytime
function DynamicFeature({ features }) {
  // Each feature gets its own tool
  features.forEach((feature) => {
    useWebMCP({
      name: `feature_${feature.id}`,
      description: feature.description,
      handler: feature.handler,
      deps: [feature],
    });
  });
}
```

### Pattern: Tool Calling Other Tools

**Before:**

```typescript
app.registerTool("composite_action", { ... }, async () => {
  // Can't easily call other app tools
  await someSharedLogic();
  return { ... };
});
```

**After:**

```typescript
// Just call the shared function directly
const sharedLogic = async () => { ... };

navigator.modelContext.registerTool({
  name: "action_a",
  handler: async () => {
    await sharedLogic();
    return { ... };
  }
});

navigator.modelContext.registerTool({
  name: "composite_action",
  handler: async () => {
    await sharedLogic();
    return { ... };
  }
});
```

## Host-Side Migration

### Before:

```typescript
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

const bridge = new AppBridge(iframe, mcpClient);

// Custom tool discovery
const { tools } = await bridge.listTools();

// Custom tool calls
const result = await bridge.callTool({
  name: "app_tool",
  arguments: { ... }
});
```

### After:

```typescript
import { Client } from "@anthropic/sdk/mcp";
import { IframeParentTransport } from "@mcp-b/transports";
import { AppBridge, FetchProxyHandler } from "@modelcontextprotocol/ext-apps/app-bridge";

// Standard MCP client for tool communication
const toolClient = new Client({ name: "host", version: "1.0.0" });
await toolClient.connect(new IframeParentTransport({ iframe }));

// Standard MCP tool discovery
const { tools } = await toolClient.listTools();

// Standard MCP tool calls
const result = await toolClient.callTool({
  name: "app_tool",
  arguments: { ... }
});

// Fetch proxy for backend communication
const proxyHandler = new FetchProxyHandler(iframe, {
  allowedOrigins: ['https://api.myapp.com']
});

// AppBridge still used for UI-specific communication
const bridge = new AppBridge(iframe, mcpClient);
bridge.sendToolInput(input);
bridge.onsizechange = ({ width, height }) => { ... };
```

## Checklist

- [ ] Add `@mcp-b/global` import at app entry point
- [ ] Initialize MCP fetch wrapper if app makes backend calls
- [ ] Convert `app.registerTool()` to `navigator.modelContext.registerTool()`
- [ ] Convert React `useApp` pattern to `useWebMCP` hooks
- [ ] Remove `app` prop drilling
- [ ] Convert `app.callServerTool()` to `fetch()`
- [ ] Remove tool-related capability declarations
- [ ] Update host to use MCP client + IframeParentTransport
- [ ] Add FetchProxyHandler on host side
- [ ] Test tool discovery and execution
- [ ] Test MCP fetch wrapper for all API endpoints
- [ ] Verify same behavior for user clicks and tool calls

## Troubleshooting

### Tools not appearing in host

1. Check that `@mcp-b/global` is imported before any tool registration
2. Verify iframe allows postMessage communication
3. Check browser console for WebMCP initialization errors

### Fetch calls failing

1. Verify `initMcpFetch()` is called before any fetch
2. Check that `shouldProxy` function matches your API URLs
3. Verify host has FetchProxyHandler with correct `allowedOrigins`

### React tools not updating

1. Ensure `deps` array includes all values the handler depends on
2. Check that handler is using current state (not stale closure)

### Type errors with Zod schemas

The WebMCP polyfill uses JSON Schema, not Zod. Convert:

```typescript
// Before (Zod)
inputSchema: z.object({ id: z.string() })

// After (JSON Schema)
inputSchema: {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"]
}

// Or use @mcp-b/react-webmcp which accepts Zod
inputSchema: { id: z.string() }  // Hook converts automatically
```
