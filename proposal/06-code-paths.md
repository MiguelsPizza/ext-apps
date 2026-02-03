# Code Paths: What Changes in ext-apps SDK

This document details the specific code changes needed to implement the WebMCP + MCP fetch wrapper architecture.

## Overview of Changes

| Component                 | Action                   | Notes                                             |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| `src/app.ts`              | Remove tool registration | Keep App + callServerTool (used by fetch wrapper) |
| `src/app-bridge.ts`       | Remove tool methods      | Keep bridge for UI protocol                       |
| `src/types.ts`            | Remove tool types        | Add MCP fetch wrapper option types                |
| `src/generated/schema.ts` | Remove tool schemas      | Regenerate                                        |
| `specification/`          | Update spec              | Document new approach                             |
| `examples/`               | Update all examples      | Use WebMCP pattern                                |
| New: `src/fetch-wrapper/` | Add MCP fetch wrapper    | New module                                        |

## File-by-File Analysis

### 1. `src/app.ts`

**Current code to REMOVE:**

```typescript
// Lines ~256-333: registerTool method
registerTool<OutputArgs, InputArgs>(
  name: string,
  config: { ... },
  cb: ToolCallback<InputArgs>,
): RegisteredTool { ... }

// Lines ~335-379: ensureToolHandlersInitialized
private _toolHandlersInitialized = false;
private ensureToolHandlersInitialized(): void { ... }

// Lines ~381-388: sendToolListChanged
async sendToolListChanged(params): Promise<void> { ... }

// Internal state
private _registeredTools: Record<string, RegisteredTool> = {};
```

**Current code to KEEP:**

```typescript
// Connection and lifecycle
connect(transport: Transport): Promise<void>
close(): Promise<void>

// Server tool calls (still needed for non-fetch use cases?)
callServerTool(params): Promise<CallToolResult>

// UI-related functionality
sendMessage(message): Promise<void>
updateModelContext(params): Promise<void>
openLink(params): Promise<McpUiOpenLinkResult>
requestDisplayMode(params): Promise<McpUiRequestDisplayModeResult>
getHostContext(): McpUiHostContext | undefined
getHostCapabilities(): McpUiHostCapabilities | undefined

// Event handlers
ontoolinput, ontoolresult, onhostcontextchanged, etc.

// Auto-resize
sendSizeChanged(params): Promise<void>
```

**New code to ADD:**

- No new methods required on `App`. Keep `callServerTool()` for the fetch wrapper.
- (Optional) add a lightweight `isConnected()` helper if we want cleaner gating.

**Estimated diff:** Remove ~150 lines, add ~0–10 lines

### 2. `src/app-bridge.ts`

**Current code to REMOVE:**

```typescript
// Lines ~1337-1351 (approximate): Tool methods
async callTool(params: CallToolRequest["params"]): Promise<CallToolResult>
async listTools(params: ListToolsRequest["params"]): Promise<ListToolsResult>
sendToolListChanged(params?): Promise<void>

// Related handlers
oncalltool, onlisttools setters and storage
```

**Current code to KEEP:**

```typescript
// Core bridge functionality
constructor(iframe, mcpClient)
connect(transport): Promise<void>

// UI communication
sendToolInput(input): Promise<void>
sendToolResult(result): Promise<void>
teardownResource(): Promise<void>

// Event handlers for UI
onsizechange, ondisplaymodechange, etc.
```

**New code to ADD:**

- No host proxy handler needed.
- Add a **transport multiplexer** or channel tagging so WebMCP + MCP UI can share `postMessage` safely.

**Estimated diff:** Remove ~50 lines, add ~50–100 lines (mux support)

### 3. `src/types.ts`

**Current types to REMOVE:**

```typescript
// Tool-related types
export type RegisteredTool = { ... }
export type ToolCallback<T> = ...

// If exists, remove from capabilities
tools?: { listChanged?: boolean }  // in app capabilities
```

**Current types to KEEP:**

```typescript
// All UI-related types
McpUiHostContext;
McpUiHostCapabilities;
McpUiAppCapabilities;
McpUiResourceMeta;
// etc.
```

**New types to ADD:**

```typescript
// MCP fetch wrapper options (app-side only)
export interface McpFetchOptions {
  interceptPaths?: string[];
  onIntercept?: (url: string, init?: RequestInit) => void;
}
```

### 4. New Module: `src/fetch-wrapper/`

**New files to create:**

```
src/fetch-wrapper/
├── index.ts           # Public exports
├── client.ts          # App-side MCP fetch wrapper
└── types.ts           # Options types
```

**`src/fetch-wrapper/index.ts`:**

```typescript
export { initMcpFetch } from "./client";
export type { McpFetchOptions } from "./types";
```

**`src/fetch-wrapper/client.ts`:**

```typescript
import type { App } from "../app";
import type { McpFetchOptions } from "./types";

export function initMcpFetch(app: App, options: McpFetchOptions = {}): void {
  const interceptPaths = options.interceptPaths ?? ["/"];
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = normalizeUrl(input);

    if (!shouldIntercept(url, interceptPaths)) {
      return originalFetch(input, init);
    }

    options.onIntercept?.(url, init);

    const result = await app.callServerTool({
      name: "http_request",
      arguments: {
        method: init?.method || "GET",
        url,
        headers: init?.headers
          ? Object.fromEntries(new Headers(init.headers))
          : undefined,
        body: init?.body ? parseBody(init.body) : undefined,
      },
    });

    return mcpResultToResponse(result);
  };
}
```

**Host-side proxy handler removed** (no raw HTTP proxy in the refined architecture).

### 5. `specification/draft/apps.mdx`

**Sections to UPDATE:**

1. Remove "App Tool Registration" section (~lines 1607-1920)
2. Remove tool-related capability declarations
3. Add new section: "WebMCP Integration"
4. Add new section: "MCP Fetch Wrapper"

**New content to ADD:**

````markdown
### WebMCP Integration

Apps expose tools to hosts using the Web Model Context API (`navigator.modelContext`).
This is an emerging web standard with polyfill support.

#### Tool Registration

```typescript
import "@mcp-b/global"; // WebMCP polyfill

navigator.modelContext.registerTool({
  name: "get_cart",
  description: "Get current shopping cart contents",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async () => ({
    items: cart.map((item) => ({ id: item.id, name: item.name })),
    total: cart.reduce((sum, item) => sum + item.price, 0),
  }),
});
```
````

#### React Integration

```typescript
import { useWebMCP } from "@mcp-b/react-webmcp";

function CartWidget() {
  const [cart, setCart] = useState([]);

  useWebMCP({
    name: "add_to_cart",
    inputSchema: { itemId: z.string() },
    handler: async ({ itemId }) => {
      const item = await fetchItem(itemId);
      setCart(prev => [...prev, item]);
      return { success: true };
    },
    deps: []
  });

  return <div>...</div>;
}
```

### MCP Fetch Wrapper

Apps running in sandboxed iframes cannot make authenticated requests directly.
The MCP fetch wrapper converts `fetch()` into `callServerTool("http_request")`.

#### App Side

```typescript
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

const app = new App({ name: "MyApp", version: "1.0.0" });
initMcpFetch(app, { interceptPaths: ["/api/"] });
await app.connect(new PostMessageTransport(window.parent));

// Now normal fetch works
const data = await fetch("/api/cart").then((r) => r.json());
```

````

### 6. Examples Updates

Each example needs updating. Here's the pattern:

**Before (current):**

```typescript
const app = new App(
  { name: "Example", version: "1.0" },
  { tools: { listChanged: true } }
);

app.registerTool("get_state", {
  description: "Get current state"
}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(state) }] };
});

app.registerTool("do_action", {
  inputSchema: z.object({ value: z.string() })
}, async ({ value }) => {
  performAction(value);
  return { content: [{ type: "text", text: "Done" }] };
});

await app.connect();
````

**After (proposed):**

```typescript
import "@mcp-b/global";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

const app = new App({ name: "Example", version: "1.0" });
initMcpFetch(app);
await app.connect(new PostMessageTransport(window.parent));

// Register tools via WebMCP
navigator.modelContext.registerTool({
  name: "get_state",
  description: "Get current state",
  handler: async () => state
});

navigator.modelContext.registerTool({
  name: "do_action",
  description: "Perform an action",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"]
  },
  handler: async ({ value }) => {
    performAction(value);
    return { success: true };
  }
});

// If using React:
function ExampleApp() {
  useWebMCP({
    name: "get_state",
    handler: async () => state,
    deps: [state]
  });

  useWebMCP({
    name: "do_action",
    inputSchema: { value: z.string() },
    handler: async ({ value }) => {
      performAction(value);
      return { success: true };
    },
    deps: []
  });

  return <div>...</div>;
}
```

### 7. Package Dependencies

**Add to `package.json`:**

```json
{
  "dependencies": {
    "@mcp-b/global": "^x.x.x",
    "@mcp-b/react-webmcp": "^x.x.x",
    "@mcp-b/transports": "^x.x.x"
  },
  "peerDependencies": {
    "@mcp-b/global": "^x.x.x"
  }
}
```

Or, create simplified versions of these packages within ext-apps.

## Summary of Changes

| Category          | Files                                 | Lines Removed | Lines Added |
| ----------------- | ------------------------------------- | ------------- | ----------- |
| Core SDK          | `app.ts`, `app-bridge.ts`, `types.ts` | ~250          | ~50         |
| MCP Fetch Wrapper | New `src/fetch-wrapper/`              | 0             | ~150        |
| Types/Schemas     | `types.ts`, `schema.ts`               | ~100          | ~50         |
| Specification     | `apps.mdx`                            | ~500          | ~200        |
| Examples          | All example apps                      | ~500          | ~300        |
| Tests             | Test files                            | ~500          | ~300        |
| **Total**         |                                       | **~1850**     | **~1300**   |

**Net reduction: ~550 lines** (plus cleaner, more portable code)

## Migration Path

1. **Phase 1:** Add MCP fetch wrapper as new module (non-breaking)
2. **Phase 2:** Add WebMCP as peer dependency, document usage
3. **Phase 3:** Deprecate `registerTool`, `callTool`, `listTools`
4. **Phase 4:** Remove deprecated methods in next major version
