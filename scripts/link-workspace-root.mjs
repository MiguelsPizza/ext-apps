#!/usr/bin/env node
/**
 * Links the root package into node_modules for workspace resolution.
 *
 * npm workspaces copy the root package at install time, but this copy
 * doesn't include files built after install. This script replaces the
 * copy with a symlink so that workspace packages can access the built dist.
 */
import { existsSync, rmSync, symlinkSync, lstatSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const targetPath = join(
  projectRoot,
  "node_modules",
  "@modelcontextprotocol",
  "ext-apps",
);

// Check if it's already a symlink pointing to the right place
if (existsSync(targetPath)) {
  try {
    const stats = lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      console.log("[link-workspace-root] Already a symlink, skipping");
      process.exit(0);
    }
    // Remove the directory copy
    console.log(
      "[link-workspace-root] Removing copy of root package from node_modules...",
    );
    rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    console.error(
      "[link-workspace-root] Error checking/removing existing path:",
      err.message,
    );
  }
}

// Create symlink
try {
  console.log("[link-workspace-root] Creating symlink to root package...");
  symlinkSync(projectRoot, targetPath, "dir");
  console.log("[link-workspace-root] Done!");
} catch (err) {
  console.error("[link-workspace-root] Error creating symlink:", err.message);
  process.exit(1);
}
