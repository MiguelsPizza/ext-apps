# HTTP Adapter PR Commit Story

This document outlines a clean, narrative commit sequence for the HTTP adapter work so the PR reads as a coherent story. If we decide to drop proposal content from history, remove the proposal commit(s) at the end.

## Proposed Commit Sequence

1. **HTTP adapter: debug-gated error context & validation**
   - Adds debug flag and improved parse/response diagnostics.
   - Keeps runtime behavior compatible while improving debuggability.

2. **HTTP adapter: browser test coverage updates**
   - Extends fetch/XHR browser tests for parity and new behaviors.

3. **HTTP adapter: full-flow E2E harness (host/app + MSW)**
   - Adds a realistic host/app environment to validate postMessage → host → MCP → HTTP flow.

4. **Examples: cleanup + polish**
   - Removes stray comments and aligns examples with repo style.

5. **Proposal/docs: rationale + SEP outline** (optional)
   - Adds language-agnostic framing and UI-only-tool rationale.
   - Safe to drop if we want purely code changes in git history.

6. **Tooling/config adjustments**
   - Package/build changes required by the above.

## If we need to trim history

- Drop commit (5) to remove proposal docs.
- Combine commits (1)-(3) if we want a tighter technical stack story.
