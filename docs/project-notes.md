---
title: Project Notes
---

# Project Notes

This document captures recent implementation notes and where to find key pieces in the repo.

## Dual-mode HTTP (fetch/XHR adapter)

- Proposal docs: `proposal/12-dual-mode-pattern.md` (dev vs prod behavior) and `proposal/README.md` (index).
- SDK implementation: `src/http-adapter/` (fetch wrapper, XHR wrapper, shared helpers, init).
- Tests:
  - Browser (logic-level): `tests/browser/fetch-wrapper.browser.test.ts`, `tests/browser/xhr-wrapper.browser.test.ts`.
  - E2E (full flow): `tests/e2e/http-adapter.spec.ts` (fetch + XHR direct/proxy through host → MCP → HTTP).
- E2E host/app fixtures + MSW:
  - Host/app pages: `examples/basic-host/http-adapter-host.html`, `examples/basic-host/http-adapter-app.html`
  - Host/app scripts: `examples/basic-host/src/http-adapter-host.ts`, `examples/basic-host/src/http-adapter-app.ts`
  - MSW worker: `examples/basic-host/public/mockServiceWorker.js`
- Examples:
  - `examples/basic-server-vanillajs` shows the http-adapter in a starter template.
  - `examples/hono-react-server` shows Hono + React with dual-mode HTTP and a type-safe `hc` client.

## Repo housekeeping

- Generated artifacts are ignored via `.gitignore` (build output, node_modules, Playwright output, caches, env files).
