# Current Architecture: MCP Apps + PR #72

This document describes how MCP Apps work today, including the tool registration system proposed in PR #72.

## Overview

MCP Apps extend the Model Context Protocol to enable servers to deliver interactive user interfaces to hosts. The architecture consists of three main components:

```
View (App iframe) <──PostMessage──> Host (AppBridge) <──MCP──> MCP Server
```

## The App Class

Apps are built using the `App` class from `@modelcontextprotocol/ext-apps`:

```typescript
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const app = new App(
  { name: "MyApp", version: "1.0.0" },           // appInfo
  { tools: { listChanged: true } },               // capabilities
  { autoResize: true }                            // options
);

// Register handlers BEFORE connecting
app.ontoolinput = (params) => { /* handle tool input */ };
app.ontoolresult = (result) => { /* handle tool result */ };

await app.connect(new PostMessageTransport(window.parent));
```

## App Instance Access Patterns

### Vanilla JS: Module-Level Singleton

```typescript
// mcp-app.ts
const app = new App({ name: "App", version: "1.0" });

button.onclick = () => app.callServerTool({ name: "do_thing", arguments: {} });
```

### React: Hook + Prop Drilling

```typescript
function MyApp() {
  const { app, isConnected } = useApp({
    appInfo: { name: "App", version: "1.0" },
    onAppCreated: (app) => {
      app.ontoolresult = (result) => { /* ... */ };
    }
  });

  if (!isConnected) return <Loading />;
  return <ChildComponent app={app} />;  // Must pass down
}

function ChildComponent({ app }: { app: App }) {
  // Can use app here
}
```

**No global access.** Components must receive `app` via props or create their own context.

## Tool Registration (PR #72)

PR #72 adds the ability for apps to register their own tools:

### App Side: registerTool()

```typescript
const app = new App(
  { name: "TicTacToe", version: "1.0" },
  { tools: { listChanged: true } }  // Declare capability
);

const moveTool = app.registerTool(
  "make_move",
  {
    description: "Make a move",
    inputSchema: z.object({ position: z.number().min(0).max(8) }),
    outputSchema: z.object({ board: z.array(z.string()), winner: z.string().nullable() }),
    annotations: { readOnlyHint: false }
  },
  async ({ position }) => {
    board[position] = currentPlayer;
    return {
      content: [{ type: "text", text: `Moved to ${position}` }],
      structuredContent: { board, winner: checkWinner() }
    };
  }
);

await app.connect();
```

### RegisteredTool Lifecycle

```typescript
const tool = app.registerTool("my_tool", config, callback);

tool.enable();   // Make available in tools/list
tool.disable();  // Hide from tools/list
tool.update({ description: "New description" });  // Update metadata
tool.remove();   // Delete entirely

// All trigger notifications/tools/list_changed
```

### Host Side: callTool() / listTools()

```typescript
// Host discovers app tools
const { tools } = await bridge.listTools({});

// Host calls app tool
const result = await bridge.callTool({
  name: "make_move",
  arguments: { position: 4 }
});
```

## Bidirectional Tool Flow

PR #72 establishes bidirectional communication:

```
App → Host → Server:  app.callServerTool()  // App calls server tools
Host → App:           bridge.callTool()      // Host calls app tools
```

### App Calling Server Tools

```typescript
// App needs to call a server tool
const result = await app.callServerTool({
  name: "get_weather",
  arguments: { city: "NYC" }
});
```

This is necessary because:
- Iframe is sandboxed (different origin)
- Iframe doesn't have auth cookies
- Must proxy through host which has MCP client connection

### Host Calling App Tools

```typescript
// Host (or model) wants to interact with app
const state = await bridge.callTool({ name: "get_board_state" });
await bridge.callTool({ name: "make_move", arguments: { position: 4 } });
```

## Automatic Handler Setup

When `registerTool()` is first called, automatic handlers are initialized:

```typescript
// src/app.ts
private ensureToolHandlersInitialized(): void {
  this.oncalltool = async (params, extra) => {
    const tool = this._registeredTools[params.name];
    if (!tool) throw new Error(`Tool ${params.name} not found`);
    return tool.handler(params.arguments, extra);
  };

  this.onlisttools = async () => {
    const tools = Object.entries(this._registeredTools)
      .filter(([_, tool]) => tool.enabled)
      .map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema),
        // ...
      }));
    return { tools };
  };
}
```

## Schema Validation

Input and output validation using Zod:

```typescript
app.registerTool("search", {
  inputSchema: z.object({
    query: z.string().min(1).max(100),
    limit: z.number().positive().default(10)
  }),
  outputSchema: z.object({
    results: z.array(z.object({ title: z.string(), url: z.string() }))
  })
}, async (params) => {
  // params validated before callback
  // return value validated after callback
});
```

## PostMessageTransport

Communication uses PostMessage:

```typescript
// View side
const transport = new PostMessageTransport(window.parent, window.parent);

// Host side
const transport = new PostMessageTransport(
  iframe.contentWindow!,
  iframe.contentWindow!
);
```

## Problems with Current Architecture

### 1. Custom Tool Registration
- Duplicates what WebMCP already provides
- Not aligned with W3C `navigator.modelContext` trajectory
- Requires passing `app` instance through component tree

### 2. Every Backend Call is an MCP Tool
- `app.callServerTool()` for all backend communication
- Forces MCP-shaped APIs for normal REST/GraphQL calls
- High friction for porting existing apps

### 3. Separate Code Paths
- UI buttons trigger one flow
- Model tools trigger another flow
- Same action, different implementations

### 4. No Global Access
- Must pass `app` as prop or use closures
- Libraries can't easily register tools
- Nested components need plumbing

### 5. SDK Lock-in
- Tools only work in ext-apps context
- Same code doesn't work as standalone website
- No path to browser-native support

## Example: Budget Allocator

From `examples/budget-allocator-server/src/mcp-app.ts`:

```typescript
const app = new App(
  { name: "Budget Allocator", version: "1.0.0" },
  { tools: { listChanged: true } }
);

// Tool 1: Query state
app.registerTool("get-allocations", {
  title: "Get Budget Allocations",
  description: "Get current budget allocations..."
}, async () => {
  const allocations = {};
  for (const category of state.config.categories) {
    allocations[category.id] = {
      percent: state.allocations.get(category.id),
      amount: (percent / 100) * state.totalBudget
    };
  }
  return { content: [...], structuredContent: { totalBudget, allocations } };
});

// Tool 2: Mutate state
app.registerTool("set-allocation", {
  inputSchema: z.object({
    categoryId: z.string(),
    percent: z.number().min(0).max(100)
  })
}, async (args) => {
  state.allocations.set(args.categoryId, args.percent);
  updateChart();
  return { content: [...] };
});

// ... more tools for every action
```

Every UI action has a corresponding tool. The model interacts via tools. The user interacts via UI. Two separate paths to the same logic.

## Summary

| Aspect | Current Architecture |
|--------|---------------------|
| **Tool registration** | `app.registerTool()` |
| **Tool access** | Pass `app` instance |
| **Backend calls** | `app.callServerTool()` |
| **Validation** | Zod schemas |
| **Lifecycle** | enable/disable/update/remove |
| **Transport** | PostMessageTransport |
| **Standardization** | ext-apps specific |

The current architecture works, but requires significant buy-in to MCP's RPC model and doesn't leverage emerging web standards.
