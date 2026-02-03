import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "@/app.ts";
import {
  createHttpRequestToolHandler,
  initMcpFetch,
  wrapCallToolHandlerWithFetchProxy,
} from "@/http-adapter/fetch-wrapper/fetch.ts";

function createAppStub(result: CallToolResult) {
  const callServerTool = vi.fn().mockResolvedValue(result);
  const getHostCapabilities = vi.fn(() => ({ serverTools: {} }));
  return {
    app: { callServerTool, getHostCapabilities } as unknown as App,
    callServerTool,
  };
}

describe("fetch-wrapper (browser)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("intercepts fetch and calls http_request", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };

    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    const response = await handle.fetch("/api/time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(callServerTool).toHaveBeenCalledTimes(1);

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.name).toBe("http_request");
    expect(call.arguments.url).toBe("/api/time");
    expect(call.arguments.method).toBe("POST");
    expect(call.arguments.bodyType).toBe("json");
    expect(call.arguments.body).toEqual({ a: 1 });

    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("falls back to native fetch when not connected to MCP host", async () => {
    const callServerTool = vi.fn();
    const app = {
      callServerTool,
      getHostCapabilities: () => undefined,
    } as unknown as App;

    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
      fallbackToNative: true,
    });

    const response = await handle.fetch("/public");

    expect(callServerTool).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("native");
  });

  it("respects interceptPaths", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
      interceptPaths: ["/api"],
    });

    const response = await handle.fetch("/public");

    expect(callServerTool).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("native");
  });

  it("skips interception for absolute URLs when disallowed", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
      allowAbsoluteUrls: false,
    });

    const response = await handle.fetch("https://example.com/api");

    expect(callServerTool).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("native");
  });

  it("serializes text body correctly", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    await handle.fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Hello, World!",
    });

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("text");
    expect(call.arguments.body).toBe("Hello, World!");
  });

  it("serializes URLSearchParams body as urlEncoded", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    const params = new URLSearchParams();
    params.set("foo", "bar");
    params.set("baz", "qux");

    await handle.fetch("/api/form", {
      method: "POST",
      body: params,
    });

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("urlEncoded");
    expect(call.arguments.body).toBe("foo=bar&baz=qux");
  });

  it("serializes FormData body with fields", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    const formData = new FormData();
    formData.append("name", "John");
    formData.append("age", "30");

    await handle.fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("formData");
    expect(call.arguments.body).toEqual([
      { name: "name", value: "John" },
      { name: "age", value: "30" },
    ]);
  });

  it("serializes Blob body as base64", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const blob = new Blob([bytes], { type: "application/octet-stream" });

    await handle.fetch("/api/binary", {
      method: "POST",
      body: blob,
    });

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("base64");
    expect(call.arguments.body).toBe(btoa("Hello"));
  });

  it("serializes ArrayBuffer body as base64", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);
    const nativeFetch = vi.fn(
      async () => new Response("native", { status: 200 }),
    );

    const handle = initMcpFetch(app, {
      fetch: nativeFetch,
      installGlobal: false,
    });

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    await handle.fetch("/api/binary", {
      method: "POST",
      body: bytes.buffer,
    });

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("base64");
    expect(call.arguments.body).toBe(btoa(String.fromCharCode(...bytes)));
  });
});

describe("fetch proxy handler (browser)", () => {
  it("proxies requests, strips forbidden headers, and returns structured content", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBeNull();
        expect(headers.get("x-server")).toBe("1");
        expect(headers.get("x-client")).toBe("2");
        expect(init?.body).toBe(JSON.stringify({ foo: "bar" }));

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      fetch: fetchSpy,
      headers: { "x-server": "1" },
    });

    const result = await handler({
      name: "http_request",
      arguments: {
        method: "POST",
        url: "/api/test",
        headers: {
          authorization: "secret",
          "x-client": "2",
        },
        body: { foo: "bar" },
        bodyType: "json",
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      status: 200,
      bodyType: "json",
      body: { ok: true },
    });
  });

  it("rejects disallowed paths", async () => {
    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      fetch: vi.fn(),
    });

    await expect(
      handler({
        name: "http_request",
        arguments: { url: "/private" },
      }),
    ).rejects.toThrow("Path not allowed");
  });

  it("rejects oversized bodies", async () => {
    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      maxBodySize: 10,
      fetch: vi.fn(),
    });

    await expect(
      handler({
        name: "http_request",
        arguments: {
          url: "/api/test",
          body: "x".repeat(32),
          bodyType: "text",
        },
      }),
    ).rejects.toThrow("exceeds maximum allowed size");
  });

  it("delegates non-http_request tools", async () => {
    const baseHandler = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    const wrapped = wrapCallToolHandlerWithFetchProxy(baseHandler, {
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      fetch: vi.fn(async () => new Response("{}", { status: 200 })),
    });

    await wrapped({ name: "other_tool", arguments: {} }, {});

    expect(baseHandler).toHaveBeenCalledTimes(1);
  });
});
