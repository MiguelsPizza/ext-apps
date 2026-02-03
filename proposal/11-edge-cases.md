# Edge Cases: Protocols, Transports, and Limitations

This document explores edge cases and protocol variations that the proposal must address.

## Beyond REST: Protocol Variations

### GraphQL

GraphQL typically uses a single POST endpoint with queries/mutations in the body.

**How it works with our architecture:**

```typescript
// App code - standard GraphQL client
const result = await fetch("/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `mutation AddToCart($itemId: ID!) {
      addToCart(itemId: $itemId) { id quantity }
    }`,
    variables: { itemId: "123" },
  }),
});
```

**Status: Works.** The fetch wrapper intercepts this like any other POST request. The MCP server's `http_request` tool proxies it to the GraphQL backend.

**Considerations:**

- Single endpoint means less URL/path-based validation
- Query complexity limits might need server-side enforcement
- Subscriptions (WebSocket-based) need separate handling

### tRPC / JSON-RPC

These use HTTP but with RPC semantics encoded in the body.

```typescript
// tRPC client
const result = await trpc.cart.add.mutate({ itemId: "123" });
// Under the hood: POST /trpc/cart.add with JSON body
```

**Status: Works.** tRPC uses fetch internally. The wrapper intercepts it.

### gRPC-Web

gRPC-Web uses HTTP/2 or HTTP/1.1 with binary protobuf encoding.

```typescript
// gRPC-Web client
const client = new CartServiceClient("https://api.example.com");
const response = await client.addToCart(
  new AddToCartRequest({ itemId: "123" }),
);
```

**Status: Partially works.**

- gRPC-Web uses fetch with binary bodies
- Need to handle `ArrayBuffer` bodies in the wrapper
- Content-Type is `application/grpc-web` or `application/grpc-web+proto`
- Streaming RPCs need special handling

**Required changes:**

```typescript
// http_request tool needs to handle binary
inputSchema: z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
  bodyEncoding: z.enum(["text", "base64", "binary"]).optional(),
});
```

---

## Real-Time Protocols

### WebSocket

WebSockets establish persistent bidirectional connections.

```typescript
const ws = new WebSocket("wss://api.example.com/realtime");
ws.onmessage = (event) => {
  /* handle updates */
};
ws.send(JSON.stringify({ action: "subscribe", channel: "cart" }));
```

**Status: Possible with MCP notifications (requires protocol extension).**

**Recommended pattern:**

1. **WebSocket proxy tool** — MCP server maintains WS connection, proxies messages

   ```typescript
   server.registerTool("ws_connect", { ... }); // returns connectionId
   server.registerTool("ws_send", { ... });
   server.registerTool("ws_close", { ... });
   // Server sends notifications/ws_message { connectionId, data }
   ```

2. **Wrapper** — Iframe exposes a WebSocket-like API that listens for `notifications/ws_message`

**Notes:**

- Host must forward these notifications to the iframe
- Protocol needs connection lifecycle + backpressure semantics

### Server-Sent Events (SSE)

SSE provides server-to-client streaming over HTTP.

```typescript
const eventSource = new EventSource("/api/events");
eventSource.onmessage = (event) => {
  /* handle */
};
```

**Status: Possible with MCP notifications (requires protocol extension).**

**Recommended pattern:**

1. **SSE proxy tool** — MCP server opens EventSource, pushes events

   ```typescript
   server.registerTool("sse_connect", { ... }); // returns connectionId
   server.registerTool("sse_close", { ... });
   // Server sends notifications/sse_event { connectionId, event, data }
   ```

2. **Wrapper** — Iframe exposes EventSource-like API listening for notifications

**Notes:**

- Host must forward these notifications to the iframe
- App should implement reconnect/backoff

---

## HTTP Client Variations

### XMLHttpRequest (XHR)

Legacy but still used by some libraries.

```typescript
const xhr = new XMLHttpRequest();
xhr.open("POST", "/api/cart");
xhr.send(JSON.stringify({ itemId: "123" }));
```

**Status: Does not work with fetch wrapper.**

**Options:**

1. **XHR wrapper** — Also patch `XMLHttpRequest`

   ```typescript
   const OriginalXHR = window.XMLHttpRequest;
   window.XMLHttpRequest = class extends OriginalXHR {
     open(method, url) {
       this._mcpMethod = method;
       this._mcpUrl = url;
       // ... intercept and convert to callServerTool
     }
   };
   ```

2. **Recommend fetch-based libraries** — Document that XHR isn't supported

**Recommendation:** Provide XHR wrapper as optional enhancement. Modern apps use fetch.

### Axios, Got, Ky, etc.

HTTP client libraries that wrap fetch or XHR.

```typescript
// Axios
const response = await axios.post("/api/cart", { itemId: "123" });

// Ky
const response = await ky.post("/api/cart", { json: { itemId: "123" } });
```

**Status: Works if library uses fetch internally.**

- Axios in browsers uses XHR by default, but can be configured to use fetch
- Ky uses fetch
- Got is Node.js only (not relevant for iframes)

**Recommendation:** Document which libraries are compatible. Axios needs XHR wrapper or fetch adapter.

---

## Request/Response Variations

### Binary Data (Files, Images)

```typescript
// Upload
const formData = new FormData();
formData.append("file", blob);
await fetch("/api/upload", { method: "POST", body: formData });

// Download
const response = await fetch("/api/image/123");
const blob = await response.blob();
```

**Status: Partially works.**

**Challenges:**

- FormData serialization through MCP
- Large binary data through postMessage (size limits)
- Blob/ArrayBuffer handling

**Required changes:**

```typescript
// http_request input
body: z.union([
  z.string(),
  z.object({
    type: z.literal('base64'),
    data: z.string()
  }),
  z.object({
    type: z.literal('formdata'),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
      filename: z.string().optional()
    }))
  })
])

// http_request output
structuredContent: {
  status: number,
  headers: Record<string, string>,
  body: string | { type: 'base64', data: string }
}
```

### Streaming Responses

```typescript
const response = await fetch("/api/large-file");
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  processChunk(value);
}
```

**Status: Possible with protocol extension.**

**Options:**

1. **Chunked notifications** — `http_request_stream` returns `streamId`, server emits `notifications/stream_chunk` + `stream_end`
2. **Signed URLs** — Server returns short-lived URL for direct download
3. **Buffer entire response** — Simple but memory-intensive (fallback)

**Recommendation:** Prefer signed URLs for very large payloads; use chunked notifications for smaller streaming needs.

### Request Timeouts

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await fetch("/api/slow", { signal: controller.signal });
```

**Status: Partially works.**

The fetch wrapper can implement timeout, but:

- MCP tool call is already in flight
- Can't abort server-side request
- Need to handle timeout gracefully

**Required changes:**

```typescript
// Add timeout to http_request
inputSchema: z.object({
  // ...
  timeout: z.number().optional(), // Server-side timeout
});
```

---

## Authentication Variations

### Cookie-Based Auth

**Status: Works.** MCP server makes request with appropriate auth headers/cookies.

### Bearer Token

**Status: Works.** MCP server has OAuth token from connection.

### API Key in Header

**Status: Works.** MCP server can inject API key.

### Client Certificates (mTLS)

**Status: Depends.** MCP server must be configured with certificates.

### Browser-Based OAuth Flows

```typescript
// Redirect to OAuth provider
window.location.href = "https://oauth.provider.com/authorize?...";
```

**Status: Possible with popup or host mediation.**

**Options:**

1. **Popup-based OAuth** — Open popup for auth flow (requires sandbox `allow-popups`)
2. **Host-mediated OAuth** — Host handles OAuth, passes token to MCP server
3. **Pre-authenticated** — MCP connection already has OAuth token

**Recommendation:** Prefer connection-level OAuth. Use popup flow only when necessary.

---

## Edge Cases Summary

| Protocol/Feature   | Status      | Notes                                |
| ------------------ | ----------- | ------------------------------------ |
| REST (JSON)        | ✅ Works    | Primary use case                     |
| GraphQL            | ✅ Works    | Single endpoint, queries in body     |
| tRPC / JSON-RPC    | ✅ Works    | Uses fetch internally                |
| gRPC-Web           | ⚠️ Partial  | Needs binary body support            |
| WebSocket          | ⚠️ Possible | Needs ws\_\* tools + notifications   |
| Server-Sent Events | ⚠️ Possible | Needs sse\_\* tools + notifications  |
| XMLHttpRequest     | ⚠️ Partial  | Needs XHR wrapper                    |
| Axios (fetch mode) | ✅ Works    | Configure to use fetch               |
| Axios (XHR mode)   | ❌ No       | Needs XHR wrapper                    |
| File Upload        | ⚠️ Partial  | FormData serialization needed        |
| File Download      | ⚠️ Partial  | Large files problematic              |
| Streaming Response | ⚠️ Possible | Chunked notifications or signed URLs |
| Request Abort      | ⚠️ Partial  | Client-side only                     |
| Cookie Auth        | ✅ Works    | Server handles                       |
| Bearer Token       | ✅ Works    | From MCP OAuth                       |
| OAuth Redirect     | ⚠️ Possible | Popup or host-mediated               |

---

## Recommendations

### Must Have (MVP)

1. **REST/JSON** — Full support via fetch wrapper
2. **GraphQL** — Works automatically
3. **Bearer token auth** — From MCP OAuth connection
4. **Basic binary support** — Base64 encoding for small payloads

### Should Have (v1)

1. **XHR wrapper** — For legacy library compatibility
2. **FormData support** — File uploads
3. **Timeout handling** — Server-side timeouts
4. **Binary responses** — Base64 encoded

### Nice to Have (Future)

1. **WebSocket proxy** — Via MCP notifications
2. **SSE support** — Via MCP notifications
3. **Streaming responses** — Chunked notifications or signed URLs
4. **gRPC-Web** — Full binary support

### Document as Limitations (if extensions not implemented)

1. WebSocket via polling fallback
2. SSE via polling fallback
3. Large file downloads (prefer direct URLs)
4. OAuth redirects in iframe (prefer connection-level auth)

---

## Open Questions

1. **Should the host also offer http_request?** Or only MCP server?
   - Pro: Reduces latency (no MCP round trip)
   - Con: Host needs to know backend auth

2. **How to handle request queueing/batching?**
   - Multiple concurrent fetches
   - Should they batch into single MCP call?

3. **Error semantics?**
   - HTTP errors vs MCP errors vs network errors
   - How to preserve error types through the proxy

4. **Caching?**
   - Should MCP server cache responses?
   - Should wrapper respect Cache-Control?

5. **Transport multiplexing?**
   - WebMCP tools and MCP App UI both use JSON-RPC over `postMessage`
   - Need channel tagging or a mux to prevent message collisions

6. **CORS?**
   - MCP server makes request, so CORS is server-to-backend
   - But what about preflight simulation?
