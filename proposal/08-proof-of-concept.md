# Proof of Concept: MCP Fetch Wrapper

This PoC validates the refined architecture: WebMCP for UI tools, and an MCP `http_request` tool behind a fetch wrapper.

## Goals

1. **Validate MCP-only flow** — `fetch()` becomes `tools/call http_request`
2. **Demonstrate simplicity** — UI logic stays normal web code
3. **Prove auditability** — all network I/O is MCP JSON-RPC

## Scope

### In Scope
- Minimal host using MCP client + `IframeParentTransport`
- Minimal app using WebMCP polyfill
- MCP fetch wrapper using `app.callServerTool("http_request")`
- MCP server exposing `http_request` (visibility `["app"]`)

### Out of Scope
- Production-grade streaming/WS/SSE
- Full ext-apps integration
- Migration of all examples

## Implementation Steps

### Phase 1: MCP Server + `http_request`

**Duration:** 1–2 hours

Create a minimal MCP server with:
- A standard `http_request` tool
- A mock backend (Express) or direct proxy to a real API

```typescript
server.registerTool("http_request", {
  inputSchema: HttpRequestInputSchema,
  outputSchema: HttpRequestOutputSchema,
  _meta: { ui: { visibility: ["app"] } },
}, async ({ method, url, headers, body }, context) => {
  const baseUrl = "http://localhost:3000";
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    structuredContent: {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
      bodyType: "text",
    },
  };
});
```

### Phase 2: Minimal App with WebMCP + Fetch Wrapper

**Duration:** 2–3 hours

```typescript
import "@mcp-b/global";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "@modelcontextprotocol/ext-apps/fetch-wrapper";

const app = new App({ name: "PoC App", version: "1.0.0" });
initMcpFetch(app, { interceptPaths: ["/api/"] });
await app.connect(new PostMessageTransport(window.parent));

// Normal app logic
async function addItem(item: string) {
  await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  });
}

// WebMCP tool wraps same logic
navigator.modelContext.registerTool({
  name: "add_item",
  inputSchema: { type: "object", properties: { item: { type: "string" } } },
  handler: async ({ item }) => {
    await addItem(item);
    return { success: true };
  },
});
```

### Phase 3: Minimal Host

**Duration:** 2–3 hours

Host uses MCP client + `IframeParentTransport` to discover WebMCP tools:

```typescript
const toolClient = new Client({ name: "host", version: "1.0.0" });
await toolClient.connect(new IframeParentTransport({ iframe }));

const { tools } = await toolClient.listTools();
await toolClient.callTool({ name: "add_item", arguments: { item: "demo" } });
```

### Phase 4: Test Scenarios

1. **Tool discovery** works from host
2. **Tool execution** updates app state
3. **User click** triggers the same `fetch()` path
4. **Server logs** show only MCP JSON-RPC

## Success Criteria

- [ ] `fetch()` in iframe results in `tools/call http_request`
- [ ] App logic is identical for button clicks and tool calls
- [ ] No direct host HTTP proxying
- [ ] All traffic is MCP JSON-RPC

## Notes

- This PoC deliberately avoids WS/SSE/streaming. Those are covered in the edge-case extensions and require additional protocol work.
