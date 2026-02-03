/**
 * @file React app demonstrating the dual-mode HTTP pattern.
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  useApp,
  useHostStyleVariables,
  useDocumentTheme,
} from "@modelcontextprotocol/ext-apps/react";
import { initMcpHttp } from "@modelcontextprotocol/ext-apps/http-adapter";
import { hc } from "hono/client";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { AppType, Item } from "./hono-backend.js";

import "./global.css";
import styles from "./mcp-app.module.css";

const DEFAULT_BACKEND_URL = "http://localhost:3102";

function getDirectBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BACKEND_URL;
}

function extractBackendUrlFromContext(
  context?: McpUiHostContext,
): string | undefined {
  if (!context?.toolInfo?.tool?._meta) {
    return undefined;
  }
  const meta = context.toolInfo.tool._meta as {
    demo?: { backendUrl?: unknown };
  };
  return typeof meta.demo?.backendUrl === "string"
    ? meta.demo.backendUrl
    : undefined;
}

type Mode = "connecting" | "mcp" | "direct";

type ModeCopy = {
  mode: Mode;
  value: string;
  description: string;
  showToggle: boolean;
};

function getModeCopy(
  hasApp: boolean,
  isMcp: boolean,
  proxyEnabled: boolean,
): ModeCopy {
  if (!hasApp) {
    return {
      mode: "connecting",
      value: "Connecting...",
      description: "",
      showToggle: false,
    };
  }

  if (isMcp) {
    return proxyEnabled
      ? {
          mode: "mcp",
          value: "MCP Proxied",
          description: "fetch() → MCP http_request tool → Hono backend",
          showToggle: true,
        }
      : {
          mode: "mcp",
          value: "Direct HTTP (proxy disabled)",
          description: "fetch() → Hono backend (proxy bypassed)",
          showToggle: true,
        };
  }

  return {
    mode: "direct",
    value: "Direct HTTP",
    description: "fetch() → Hono backend (no MCP)",
    showToggle: false,
  };
}

function HonoReactApp() {
  const httpHandleRef = useRef<ReturnType<typeof initMcpHttp> | null>(null);
  const proxyEnabledRef = useRef(true);
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [backendUrl, setBackendUrl] = useState(getDirectBaseUrl());
  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");

  const { app } = useApp({
    appInfo: { name: "Hono React Demo", version: "1.0.0" },
    capabilities: {},
  });

  useHostStyleVariables(app);
  useDocumentTheme();

  useEffect(() => {
    if (!app) return;

    const previousHandler = app.onhostcontextchanged;

    const updateBackendUrl = (context?: McpUiHostContext) => {
      const nextUrl = extractBackendUrlFromContext(
        context ?? app.getHostContext(),
      );
      if (nextUrl) {
        setBackendUrl(nextUrl);
      }
    };

    updateBackendUrl();
    app.onhostcontextchanged = (context) => {
      previousHandler?.(context);
      updateBackendUrl(context);
    };

    return () => {
      app.onhostcontextchanged = previousHandler ?? (() => {});
    };
  }, [app]);

  useEffect(() => {
    if (!app || httpHandleRef.current) return;

    httpHandleRef.current = initMcpHttp(app, {
      interceptPaths: ["/api/"],
      allowAbsoluteUrls: true,
      interceptEnabled: () => proxyEnabledRef.current,
      fallbackToNative: true,
    });

    return () => {
      httpHandleRef.current?.restore();
      httpHandleRef.current = null;
    };
  }, [app]);

  useEffect(() => {
    proxyEnabledRef.current = proxyEnabled;
  }, [proxyEnabled]);

  const hasApp = Boolean(app);
  const isMcp = Boolean(app?.getHostCapabilities()?.serverTools);
  const isProxying = isMcp && proxyEnabled;
  const baseUrl = isProxying ? "/" : backendUrl;
  const modeCopy = getModeCopy(hasApp, isMcp, proxyEnabled);
  const client = useMemo(() => hc<AppType>(baseUrl), [baseUrl]);

  async function fetchItems() {
    const res = await client.api.items.$get();
    const data = await res.json();
    setItems(data.items);
  }

  async function addItem() {
    const trimmedName = newItemName.trim();
    if (!trimmedName) return;

    const res = await client.api.items.$post({
      json: { name: trimmedName },
    });
    const data = await res.json();
    if ("items" in data) {
      setItems(data.items);
      setNewItemName("");
    }
  }

  async function deleteItem(id: number) {
    const res = await client.api.items[":id"].$delete({
      param: { id: id.toString() },
    });
    const data = await res.json();
    if ("items" in data) setItems(data.items);
  }

  useEffect(() => {
    if (app) fetchItems();
  }, [app, baseUrl]);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Hono React Demo</h1>
        <p className={styles.subtitle}>Dual-mode HTTP pattern demonstration</p>
      </header>

      <section className={styles.modeCard}>
        <div className={styles.modeLabel}>Current Mode</div>
        <div className={styles.modeValue}>{modeCopy.value}</div>
        {modeCopy.description && (
          <div className={styles.modeDescription}>{modeCopy.description}</div>
        )}
        {modeCopy.showToggle && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={() => setProxyEnabled((prev) => !prev)}
            />
            <span className={styles.toggleSlider} />
            <span className={styles.toggleLabel}>
              {proxyEnabled ? "Proxy On" : "Proxy Off"}
            </span>
          </label>
        )}
      </section>

      <section className={styles.card}>
        <h2>Items</h2>
        <div className={styles.row}>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="New item name"
            className={styles.input}
          />
          <button
            onClick={addItem}
            className={styles.button}
            disabled={!newItemName.trim()}
          >
            Add
          </button>
        </div>

        {items.length === 0 ? (
          <p className={styles.empty}>No items yet</p>
        ) : (
          <ul className={styles.itemList}>
            {items.map((item) => (
              <li key={item.id} className={styles.item}>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemDate}>
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => deleteItem(item.id)}
                  className={styles.deleteButton}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={fetchItems} className={styles.button}>
          Refresh List
        </button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HonoReactApp />
  </StrictMode>,
);
