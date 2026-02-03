# SEP Outline — WebMCP + HTTP Adapter (Draft)

> This file maps the existing proposal docs into a single SEP‑style outline.
> Use this as the backbone for the final SEP.

## 0) Preamble (SEP header)

- **Title:** MCP Apps: WebMCP + HTTP Adapter
- **Status:** Draft
- **Type:** Extension
- **Author(s):** TBD
- **Sponsor:** TBD
- **Created:** TBD
- **Requires:** MCP Apps SEP‑1865 (UI resources + host/app protocol)

> _Suggested placement:_ top of the final SEP doc.

## 1) Abstract

- **Source:** `proposal/README.md` (Overview)
- **Core idea:** Keep MCP auditability while allowing normal web apps via WebMCP tools + HTTP adapter.

## 2) Motivation / Problem Statement

- **Source:** `proposal/01-vision.md`
- **Supporting analysis:** `proposal/09-complexity-analysis.md`
- **Key pain points:** porting friction, per‑endpoint tools, duplicated code paths.

## 3) Goals & Non‑Goals

**Goals**

- Enable normal `fetch()`/XHR usage in MCP Apps without weakening auditability.
- Keep model‑facing semantics in WebMCP tools.
- Preserve transport‑agnostic MCP (no new wire protocol).

**Non‑Goals**

- Streaming bodies/progress events (future work).
- Replacing model‑facing tools with HTTP semantics.
- Changing MCP transports or client auth models.

## 4) Current Architecture (Background)

- **Source:** `proposal/02-current-architecture.md`
- **Context:** PR #72 tool registration model.

## 5) Proposed Architecture (Overview)

- **Source:** `proposal/04-proposed-architecture.md`
- **Includes:**
  - Host ↔ App diagram
  - Transport primitive vs semantic tools
  - UI‑only server tools vs HTTP adapter (rationale)

## 6) WebMCP Tool Model (Model‑Facing Semantics)

- **Source:** `proposal/03-webmcp-overview.md`
- **Notes:** Aligns with web standards, tool exposure via `navigator.modelContext`.

## 7) HTTP Adapter / `http_request` Tool (Transport Primitive)

- **Source:** `proposal/05-fetch-proxy.md`
- **Normative additions to draft SEP:**
  - `http_request` request schema
  - `http_response` result schema
  - Body types mapping (json/text/urlEncoded/formData/base64)
  - Error semantics (tool error vs transport error)

## 8) Dual‑Mode Development Pattern

- **Source:** `proposal/12-dual-mode-pattern.md`
- **Key point:** dev = direct HTTP; prod = MCP‑proxied HTTP.

## 9) Backwards Compatibility

- **Source:** `proposal/09-complexity-analysis.md` + `proposal/10-counterarguments.md`
- **Position:** additive; no MCP wire changes; existing apps still valid.

## 10) Security Considerations

- **Source:** `proposal/10-counterarguments.md`
- **Additions:**
  - Host remains policy/observability boundary
  - HTTP adapter does not bypass MCP; it uses tools/call
  - UI‑only tools vs HTTP adapter rationale

## 11) Reference Implementation

- **Source:** `proposal/06-code-paths.md`
- **Pointers:**
  - SDK: `src/http-adapter/*`
  - E2E test: `tests/e2e/http-adapter.spec.ts`
  - Example: `examples/basic-host/http-adapter-*.html`

## 12) Test Plan

- **Source:** `tests/browser/fetch-wrapper.browser.test.ts`
- **Source:** `tests/browser/xhr-wrapper.browser.test.ts`
- **Source:** `tests/e2e/http-adapter.spec.ts`

## 13) Alternatives / Rejected Approaches

- **Source:** `proposal/10-counterarguments.md`
- **Examples:**
  - Pure UI‑only tools for backend calls
  - Direct HTTP from iframe (same‑origin or host proxy)
  - Tool‑per‑endpoint approach

## 14) Migration Guide

- **Source:** `proposal/07-migration-guide.md`

## 15) Proof of Concept / Demo Plan

- **Source:** `proposal/08-proof-of-concept.md`

## 16) Open Questions / Future Work

- **Source:** `proposal/11-edge-cases.md`
- **Examples:** streaming/progress, larger payload controls, host‑provided limits.

---

## Appendix: Document Index

- `proposal/README.md`
- `proposal/01-vision.md`
- `proposal/02-current-architecture.md`
- `proposal/03-webmcp-overview.md`
- `proposal/04-proposed-architecture.md`
- `proposal/05-fetch-proxy.md`
- `proposal/06-code-paths.md`
- `proposal/07-migration-guide.md`
- `proposal/08-proof-of-concept.md`
- `proposal/09-complexity-analysis.md`
- `proposal/10-counterarguments.md`
- `proposal/11-edge-cases.md`
- `proposal/12-dual-mode-pattern.md`
