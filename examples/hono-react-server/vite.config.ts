import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react";
import { resolveBackendPort } from "./ports.js";

export default defineConfig(({ command }) => {
  const input = process.env.INPUT;
  if (command === "build" && !input) {
    throw new Error("INPUT env var required for build");
  }

  const backendPort = resolveBackendPort();
  const devPort = Number.parseInt(process.env.DEV_PORT ?? "3000", 10);

  return {
    plugins: [react(), viteSingleFile()],
    build: {
      outDir: "dist",
      sourcemap: process.env.NODE_ENV === "development",
      minify: process.env.NODE_ENV !== "development",
      rollupOptions: input ? { input } : undefined,
      target: "esnext",
    },
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "production",
      ),
    },
  };
});
