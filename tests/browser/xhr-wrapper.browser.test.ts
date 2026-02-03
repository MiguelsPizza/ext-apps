import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "@/app.ts";
import { initMcpXhr } from "@/http-adapter/xhr-wrapper/xhr.ts";

function createAppStub(result: CallToolResult) {
  const callServerTool = vi.fn().mockResolvedValue(result);
  const getHostCapabilities = vi.fn(() => ({ serverTools: {} }));
  return {
    app: { callServerTool, getHostCapabilities } as unknown as App,
    callServerTool,
  };
}

class FakeXMLHttpRequest extends EventTarget {
  static instances: FakeXMLHttpRequest[] = [];
  static lastRequest: {
    method: string;
    url: string;
    async: boolean;
    headers: Record<string, string>;
    body?: Document | XMLHttpRequestBodyInit | null;
  } | null = null;

  static reset() {
    FakeXMLHttpRequest.instances = [];
    FakeXMLHttpRequest.lastRequest = null;
  }

  responseType: XMLHttpRequestResponseType = "";
  response: unknown = "native";
  responseText = "native";
  responseURL = "";
  responseXML: Document | null = null;
  status = 200;
  statusText = "OK";
  readyState = 0;
  timeout = 0;
  withCredentials = false;
  upload = new EventTarget() as XMLHttpRequestUpload;

  onreadystatechange: ((this: XMLHttpRequest, ev: Event) => unknown) | null =
    null;
  onload: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  onerror: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  onabort: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  ontimeout: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onloadstart: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onloadend: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onprogress: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;

  private headers: Record<string, string> = {};

  constructor() {
    super();
    FakeXMLHttpRequest.instances.push(this);
  }

  open(
    method: string,
    url: string,
    async: boolean = true,
    _user?: string | null,
    _password?: string | null,
  ): void {
    this.readyState = 1;
    FakeXMLHttpRequest.lastRequest = {
      method,
      url,
      async,
      headers: { ...this.headers },
    };
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (!FakeXMLHttpRequest.lastRequest) {
      FakeXMLHttpRequest.lastRequest = {
        method: "GET",
        url: "",
        async: true,
        headers: {},
      };
    }
    FakeXMLHttpRequest.lastRequest = {
      ...FakeXMLHttpRequest.lastRequest,
      headers: { ...this.headers },
      body,
    };
    this.dispatchEvent(new Event("load"));
    this.dispatchEvent(new Event("loadend"));
  }

  abort(): void {
    this.dispatchEvent(new Event("abort"));
  }

  getResponseHeader(_name: string): string | null {
    return null;
  }

  getAllResponseHeaders(): string {
    return "";
  }

  overrideMimeType(_mime: string): void {
    // no-op
  }
}

const NativeXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.XMLHttpRequest = NativeXMLHttpRequest;
  FakeXMLHttpRequest.reset();
  vi.restoreAllMocks();
});

describe("xhr-wrapper (browser)", () => {
  it("intercepts XHR and calls http_request", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "json";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    xhr.open("POST", "/api/time");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", "secret");
    xhr.send(JSON.stringify({ foo: "bar" }));

    await loaded;

    expect(callServerTool).toHaveBeenCalledTimes(1);
    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.name).toBe("http_request");
    expect(call.arguments.url).toBe("/api/time");
    expect(call.arguments.method).toBe("POST");
    expect(call.arguments.bodyType).toBe("json");
    expect(call.arguments.body).toEqual({ foo: "bar" });
    expect(
      (call.arguments.headers as Record<string, string> | undefined)
        ?.authorization,
    ).toBeUndefined();

    expect(xhr.status).toBe(200);
    expect(xhr.response).toEqual({ ok: true });
    expect(() => xhr.responseText).toThrow(
      "Failed to read the 'responseText' property",
    );
    expect(xhr.readyState).toBe(4);

    warnSpy.mockRestore();
  });

  it("falls back to native XHR when not connected to MCP host", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const app = {
      callServerTool: vi.fn(),
      getHostCapabilities: () => undefined,
    } as unknown as App;

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/public");
    xhr.send();

    expect(app.callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/public");
  });

  it("respects interceptPaths", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      interceptPaths: ["/api"],
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/public");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/public");
  });

  it("skips interception for absolute URLs when disallowed", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      allowAbsoluteUrls: false,
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "https://example.com/api");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("https://example.com/api");
  });

  it("decodes base64 responses for arraybuffer responseType", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const base64 = btoa(String.fromCharCode(...bytes));

    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: base64,
        bodyType: "base64",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "arraybuffer";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/blob");
    xhr.send();

    await loaded;

    const response = xhr.response as ArrayBuffer;
    expect(new Uint8Array(response)).toEqual(bytes);
  });

  it("throws for synchronous intercepted requests", () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    expect(() => xhr.open("GET", "/api", false)).toThrow(
      "Synchronous XMLHttpRequest is not supported in MCP Apps",
    );
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("POST", "/api/text");
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.send("Hello, World!");

    await loaded;

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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const params = new URLSearchParams();
    params.set("foo", "bar");
    params.set("baz", "qux");

    xhr.open("POST", "/api/form");
    xhr.send(params);

    await loaded;

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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const formData = new FormData();
    formData.append("name", "John");
    formData.append("age", "30");

    xhr.open("POST", "/api/upload");
    xhr.send(formData);

    await loaded;

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
});
