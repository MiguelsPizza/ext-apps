# Vision: A New Interaction Model for MCP Apps

## The Problem

MCP Apps today require developers to adopt an entirely new RPC framework. Every backend action must be wrapped as an MCP tool:

```typescript
// Want to add to cart? Write an MCP tool
app.registerTool("add_to_cart", schema, handler);

// Want to update settings? Write an MCP tool
app.registerTool("update_settings", schema, handler);

// Want to fetch user data? Write an MCP tool
app.registerTool("get_user", schema, handler);
```

This creates several problems:

1. **High friction** — Existing web apps can't easily become MCP apps
2. **Duplicate code paths** — UI buttons and model tools often do the same thing differently
3. **Over-tooling** — Every API call becomes a tool, even things the model won't use
4. **SDK lock-in** — Apps are tightly coupled to ext-apps SDK patterns
5. **Testing complexity** — Two code paths to test (UI flow vs tool flow)

## The Vision

**MCP Apps should be normal web apps** with two additions:

1. **WebMCP tools** — Thin wrappers that expose UI-level interactions to the model
2. **Fetch proxy** — Transparent layer that handles auth for backend calls

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Normal Web App                                │
│                                                                      │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      │
│   │   UI Layer   │ ───► │    Logic     │ ───► │   fetch()    │      │
│   │  (buttons,   │      │  (handlers,  │      │  (REST/GQL)  │      │
│   │   forms)     │      │   state)     │      │              │      │
│   └──────────────┘      └──────────────┘      └──────────────┘      │
│          ▲                     ▲                     │               │
│          │                     │                     ▼               │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      │
│   │    User      │      │ WebMCP Tools │      │ MCP Fetch    │      │
│   │   clicks     │      │ (thin layer) │      │ Wrapper      │      │
│   └──────────────┘      └──────────────┘      └──────────────┘      │
│                                ▲                     │               │
│                                │                     ▼               │
│                         ┌──────────────┐      ┌──────────────┐      │
│                         │    Model     │      │   Host       │      │
│                         │  calls tool  │      │ (has auth)   │      │
│                         └──────────────┘      └──────────────┘      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Insight: Tools Wrap UI, Not API

**Current model:** Tools ARE the API

```typescript
// Tool directly calls backend
app.registerTool("add_to_cart", {}, async ({ itemId }) => {
  await app.callServerTool("cart_service_add", { itemId });
});
```

**Proposed model:** Tools wrap UI interactions

```typescript
// App has normal logic
function addToCart(itemId: string) {
  cart.push(itemId);
  fetch('/api/cart', { method: 'POST', body: JSON.stringify({ itemId }) });
}

// Button for user
<button onClick={() => addToCart(item.id)}>Add</button>

// Tool for model (calls same function)
navigator.modelContext.registerTool({
  name: "add_to_cart",
  handler: ({ itemId }) => addToCart(itemId)
});
```

**Same code path. Same behavior. Same bugs (and fixes).**

## What This Enables

### 1. Zero-Friction Porting

Existing web apps become MCP apps by adding:

- An MCP fetch wrapper (SDK-provided)
- WebMCP tool wrappers for key interactions

No rewrite. No new backend. No MCP server changes.

### 2. Isomorphic Code

Same app works in multiple contexts:

| Context                | UI          | WebMCP Tools           | Fetch                |
| ---------------------- | ----------- | ---------------------- | -------------------- |
| **Standalone website** | User clicks | Browser extension uses | Direct to backend    |
| **MCP App (iframe)**   | User clicks | Host uses              | Proxied through host |
| **PWA**                | User clicks | Native AI uses         | Direct to backend    |

### 3. Library Ecosystem

Component libraries can ship with WebMCP tools:

```typescript
// chart-library/Chart.tsx
export function Chart({ data }) {
  useWebMCP({ name: "export_chart_png", handler: () => exportPng() });
  useWebMCP({ name: "get_data_point", handler: ({ i }) => data[i] });
  return <canvas />;
}
```

Works on any website. Works in any MCP app. No SDK coupling.

### 4. Progressive Enhancement

A site can work without AI but expose tools when present:

```typescript
if ('modelContext' in navigator) {
  navigator.modelContext.registerTool({ ... });
}
// Site works fine either way
```

### 5. Native Browser Support Path

`navigator.modelContext` is being implemented in Chromium. When it ships:

- WebMCP polyfill becomes a no-op
- Apps continue working unchanged
- No migration needed

## The Three Layers

| Layer                 | Responsibility                   | Implementation                          |
| --------------------- | -------------------------------- | --------------------------------------- |
| **WebMCP Tools**      | Expose UI interactions to model  | `navigator.modelContext.registerTool()` |
| **Application Logic** | Business logic, state management | Normal JS/TS code                       |
| **MCP Fetch Wrapper** | MCP tool-based auth              | Fetch wrapper                           |

## What ext-apps Should Provide

Instead of custom tool registration, ext-apps should provide:

1. **Fetch proxy infrastructure** — Service worker or wrapper that proxies requests through host
2. **UI resources** — `ui://` scheme, CSP declarations, theming
3. **Host communication** — Display modes, container dimensions, context
4. **Documentation** — How to use WebMCP in MCP apps

## What ext-apps Should NOT Provide

- Custom `app.registerTool()` method (use WebMCP)
- Custom `oncalltool` / `onlisttools` handlers (use WebMCP)
- Custom tool lifecycle (enable/disable/update/remove — use WebMCP)

These are already solved by WebMCP with a path to browser standardization.

## Summary

|                       | Current Model            | Proposed Model                          |
| --------------------- | ------------------------ | --------------------------------------- |
| **Tool registration** | `app.registerTool()`     | `navigator.modelContext.registerTool()` |
| **Backend calls**     | `app.callServerTool()`   | Normal `fetch()` (proxied)              |
| **Code paths**        | Separate for UI vs model | Same for both                           |
| **App portability**   | MCP-app-specific         | Works anywhere                          |
| **Standards**         | ext-apps SDK             | W3C trajectory                          |
| **Library support**   | Requires SDK             | Just works                              |

**MCP Apps become normal web apps with superpowers, not a special category of application.**
