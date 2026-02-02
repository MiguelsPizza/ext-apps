import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const httpRequestInputSchema = z.object({
  method: z.string().default("GET"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  bodyType: z
    .enum(["none", "json", "text", "formData", "urlEncoded", "base64"])
    .optional(),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  cache: z
    .enum([
      "default",
      "no-store",
      "reload",
      "no-cache",
      "force-cache",
      "only-if-cached",
    ])
    .optional(),
  credentials: z.enum(["omit", "same-origin", "include"]).optional(),
  timeoutMs: z.number().optional(),
});

const httpRequestOutputSchema = z.object({
  status: z.number(),
  statusText: z.string().optional(),
  headers: z.record(z.string()),
  body: z.any().optional(),
  bodyType: z
    .enum(["none", "json", "text", "formData", "urlEncoded", "base64"])
    .optional(),
  url: z.string().optional(),
  redirected: z.boolean().optional(),
  ok: z.boolean().optional(),
});

type HttpRequestArgs = z.infer<typeof httpRequestInputSchema>;

function getCurrentTime(): string {
  return new Date().toISOString();
}

function buildHttpResponse(
  status: number,
  body: unknown,
  init: {
    statusText?: string;
    headers?: Record<string, string>;
    bodyType?: "json" | "text" | "formData" | "urlEncoded" | "base64" | "none";
  } = {},
): CallToolResult {
  const headers = {
    "content-type": "application/json",
    ...init.headers,
  };
  const bodyType = init.bodyType ?? "json";
  const statusText = init.statusText;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: {
      status,
      statusText,
      headers,
      body,
      bodyType,
      ok: status >= 200 && status < 300,
    },
  };
}

function normalizeRequestUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Basic MCP App Server (Vanilla JS)",
    version: "1.0.0",
  });

  // Two-part registration: tool + resource, tied together by the resource URI.
  const resourceUri = "ui://get-time/mcp-app.html";

  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time as an ISO 8601 string.",
      inputSchema: {},
      outputSchema: z.object({
        time: z.string(),
      }),
      _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
    },
    async (): Promise<CallToolResult> => {
      const time = getCurrentTime();
      return {
        content: [{ type: "text", text: time }],
        structuredContent: { time },
      };
    },
  );

  server.registerTool(
    "http_request",
    {
      description: "Proxy HTTP requests from the app to backend routes.",
      inputSchema: httpRequestInputSchema,
      outputSchema: httpRequestOutputSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: HttpRequestArgs): Promise<CallToolResult> => {
      const method = (args.method ?? "GET").toUpperCase();
      const url = normalizeRequestUrl(args.url);
      const pathname = url.split("?")[0];

      if (method !== "GET" && method !== "HEAD") {
        return buildHttpResponse(
          405,
          { error: "Method Not Allowed" },
          { statusText: "Method Not Allowed" },
        );
      }

      if (pathname === "/api/time") {
        const time = getCurrentTime();
        return buildHttpResponse(200, { time }, { statusText: "OK" });
      }

      return buildHttpResponse(404, { error: "Not Found" }, { statusText: "Not Found" });
    },
  );

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
