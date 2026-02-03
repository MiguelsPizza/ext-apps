/**
 * @file MCP server exposing the Hono demo UI and http_request proxy tool.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { createHttpRequestToolHandler } from "@modelcontextprotocol/ext-apps/fetch-wrapper";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveBackendUrl } from "./ports.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const BACKEND_URL = resolveBackendUrl();

/**
 * Creates a new MCP server instance with http_request tool and UI resource.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Hono React Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://hono-demo/mcp-app.html";
  // CSP intentionally omits connectDomains to demonstrate security boundary.
  // Direct HTTP will be blocked by CSP in sandboxed iframes; use MCP proxy instead.
  const cspMeta = {
    ui: {},
  };

  registerAppTool(
    server,
    "hono-demo",
    {
      title: "Hono Demo",
      description:
        "Interactive demo showing dual-mode HTTP pattern with Hono backend",
      inputSchema: {},
      outputSchema: z.object({
        message: z.string(),
      }),
      _meta: { ui: { resourceUri }, demo: { backendUrl: BACKEND_URL } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [{ type: "text", text: "Hono React demo loaded" }],
        structuredContent: { message: "Demo UI is ready" },
      };
    },
  );

  const httpRequestInputSchema = z.object({
    method: z.string().default("GET"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
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
    headers: z.record(z.string(), z.string()),
    body: z.any().optional(),
    bodyType: z
      .enum(["none", "json", "text", "formData", "urlEncoded", "base64"])
      .optional(),
    url: z.string().optional(),
    redirected: z.boolean().optional(),
    ok: z.boolean().optional(),
  });

  const proxyHandler = createHttpRequestToolHandler({
    baseUrl: BACKEND_URL,
    allowOrigins: [BACKEND_URL],
    allowPaths: ["/api/"],
  });

  server.registerTool(
    "http_request",
    {
      description: "Proxy HTTP requests from the app to the Hono backend",
      inputSchema: httpRequestInputSchema,
      outputSchema: httpRequestOutputSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (
      args: z.infer<typeof httpRequestInputSchema>,
    ): Promise<CallToolResult> => {
      // Adapt the signature: registerTool passes args, but proxyHandler expects params
      return proxyHandler({ name: "http_request", arguments: args });
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: cspMeta,
          },
        ],
      };
    },
  );

  return server;
}
