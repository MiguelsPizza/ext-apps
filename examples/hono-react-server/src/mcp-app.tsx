/**
 * @file React app demonstrating the dual-mode HTTP pattern.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  useApp,
  useHostStyleVariables,
  useDocumentTheme,
} from "@modelcontextprotocol/ext-apps/react";
import { initMcpHttp } from "@modelcontextprotocol/ext-apps/http-adapter";
import { hc } from "hono/client";
import type { AppType, Item } from "./hono-backend.js";

import "./global.css";
import styles from "./mcp-app.module.css";

const DEFAULT_BACKEND_URL = "http://localhost:3102";

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch (error) {
    return true;
  }
}

function getDirectBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BACKEND_URL;
}

const client = hc<AppType>(isInIframe() ? "/" : getDirectBaseUrl());

type Mode = "connecting" | "mcp" | "direct";

function HonoReactApp() {
  const httpHandleRef = useRef<ReturnType<typeof initMcpHttp> | null>(null);
  const [mode, setMode] = useState<Mode>("connecting");
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [serverTime, setServerTime] = useState<string>("—");
  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { app, error: appError } = useApp({
    appInfo: { name: "Hono React Demo", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      httpHandleRef.current = initMcpHttp(app, {
        interceptPaths: ["/api/"],
        fallbackToNative: true,
      });
    },
  });

  const toggleProxy = useCallback(() => {
    if (proxyEnabled) {
      httpHandleRef.current?.stop();
      setProxyEnabled(false);
    } else {
      httpHandleRef.current?.start();
      setProxyEnabled(true);
    }
  }, [proxyEnabled]);

  useHostStyleVariables(app);
  useDocumentTheme();

  useEffect(() => {
    if (app) {
      const isMcp = Boolean(app.getHostCapabilities()?.serverTools);
      setMode(isMcp ? "mcp" : "direct");
    }
  }, [app]);

  const fetchTime = useCallback(async () => {
    try {
      setError(null);
      const res = await client.api.time.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServerTime(data.time);
    } catch (e) {
      setError(`Failed to fetch time: ${(e as Error).message}`);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await client.api.items.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items);
    } catch (e) {
      setError(`Failed to fetch items: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const addItem = useCallback(async () => {
    if (!newItemName.trim()) return;

    try {
      setError(null);
      setLoading(true);
      const res = await client.api.items.$post({
        json: { name: newItemName.trim() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items);
      setNewItemName("");
    } catch (e) {
      setError(`Failed to add item: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [newItemName]);

  const deleteItem = useCallback(async (id: number) => {
    try {
      setError(null);
      setLoading(true);
      const res = await client.api.items[":id"].$delete({
        param: { id: id.toString() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items);
    } catch (e) {
      setError(`Failed to delete item: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== "connecting") {
      fetchItems();
    }
  }, [mode, fetchItems]);

  if (appError) {
    return (
      <main className={styles.main}>
        <div className={styles.error}>Error: {appError.message}</div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Hono React Demo</h1>
        <p className={styles.subtitle}>Dual-mode HTTP pattern demonstration</p>
      </header>

      <section className={styles.modeCard}>
        <div className={styles.modeLabel}>Current Mode</div>
        <div className={styles.modeValue}>
          {mode === "connecting" && "Connecting..."}
          {mode === "mcp" && proxyEnabled && "MCP Proxied"}
          {mode === "mcp" && !proxyEnabled && "Direct HTTP (proxy disabled)"}
          {mode === "direct" && "Direct HTTP"}
        </div>
        <div className={styles.modeDescription}>
          {mode === "mcp" &&
            proxyEnabled &&
            "fetch() → MCP http_request tool → Hono backend"}
          {mode === "mcp" &&
            !proxyEnabled &&
            "fetch() → Hono backend (proxy bypassed)"}
          {mode === "direct" && "fetch() → Hono backend (no MCP)"}
        </div>
        {mode === "mcp" && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={toggleProxy}
            />
            <span className={styles.toggleSlider} />
            <span className={styles.toggleLabel}>
              {proxyEnabled ? "Proxy On" : "Proxy Off"}
            </span>
          </label>
        )}
      </section>

      <section className={styles.card}>
        <h2>Server Time</h2>
        <div className={styles.row}>
          <code className={styles.time}>{serverTime}</code>
          <button onClick={fetchTime} className={styles.button}>
            Refresh
          </button>
        </div>
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
            disabled={loading}
          />
          <button
            onClick={addItem}
            className={styles.button}
            disabled={loading || !newItemName.trim()}
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
                  disabled={loading}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={fetchItems}
          className={styles.button}
          disabled={loading}
        >
          Refresh List
        </button>
      </section>

      {error && <div className={styles.error}>{error}</div>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HonoReactApp />
  </StrictMode>,
);
