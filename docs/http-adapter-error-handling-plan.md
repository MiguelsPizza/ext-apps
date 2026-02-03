# HTTP Adapter Error Handling Implementation Plan

This document outlines the implementation plan for addressing critical and important error handling issues identified in the PR review for the HTTP adapter module.

## Guiding Constraints

- Keep behavior backwards-compatible where possible (no new runtime deps).
- Avoid environment-specific globals (e.g., no `process.env` checks in browser code).
- Add debug logging only when explicitly enabled.

---

## Critical Issues

### 1. Silent JSON Parse Failures in `safeJsonParse`

**Location:** `src/http-adapter/shared/json.ts:8-14`

**Problem:** The function silently swallows ALL parse errors, returning `undefined` without any logging. This makes debugging malformed responses extremely difficult.

**Implementation:**

```typescript
export interface JsonParseOptions {
  context?: string;
  debug?: boolean;
}

export function safeJsonParse(
  value: string,
  options: JsonParseOptions = {},
): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (options.debug && options.context) {
      console.debug(
        `[MCP HTTP] JSON parse failed for ${options.context}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    return undefined;
  }
}
```

**New option:**

- Add `debug?: boolean` to `McpHttpBaseOptions` and `McpHttpProxyOptions` in `src/http-adapter/http-options.ts`.
- Pass `debug` through request/response parsing code paths.

**Affected call sites to update:**

- `src/http-adapter/shared/body.ts:83` - Add context `"request body"`
- `src/http-adapter/shared/body.ts:180` - Add context `"request body"`
- `src/http-adapter/shared/body.ts:268` - Add context `"http_request response"`
- `src/http-adapter/fetch-wrapper/fetch.ts:656` - Add context `"proxy response"`

**Testing:**

- Add test for invalid JSON with `debug: true` (assert console.debug called).
- Add test for invalid JSON with `debug: false` (no logging).

---

### 2. Broad Catch Block in XHR Request Execution

**Location:** `src/http-adapter/xhr-wrapper/xhr.ts:445-449` and `_handleError` at line 572-594

**Problem:** All errors (including programming bugs like TypeError, ReferenceError) are converted to generic "XHR error" events. The original error's stack trace is lost.

**Implementation:**

```typescript
// Add to McpXMLHttpRequest class
private _lastError: unknown = null;

// In _handleError method:
private _handleError(error: unknown): void {
  this._lastError = error;

  if (options.debug) {
    console.error("[MCP XHR] Request failed:", {
      url: this._url,
      method: this._method,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  // Preserve existing event behavior
  this._status = 0;
  this._statusText = "";
  this._response = null;
  this._responseText = "";

  this._setReadyState(McpXMLHttpRequest.DONE);

  if (error instanceof Error && error.name === "AbortError" && this.timeout > 0) {
    this._dispatchProgressEvent("timeout", 0, 0, false);
  } else {
    this._dispatchProgressEvent("error", 0, 0, false);
  }

  this._dispatchProgressEvent("loadend", 0, 0, false);
}
```

**Notes:**

- `_lastError` is internal only (not part of public API).
- Do not change existing event semantics beyond improved logging/context.

**Testing:**

- Add test that `_lastError` is set when tool call fails.
- Verify `console.error` is only called when `debug: true`.

---

### 3. Silent Fallback on FormData Parse Failure

**Location:** `src/http-adapter/shared/body.ts:195-204`

**Problem:** When parsing multipart/form-data fails, the code silently falls back to binary encoding. File uploads will fail because the server expects form fields but receives raw bytes.

**Implementation:**

```typescript
console.warn(
  "[MCP HTTP] Failed to parse multipart/form-data. " +
    "The request body will be sent as binary, which may cause server-side parsing failures. " +
    "If this is unexpected, verify the multipart boundary is valid.",
  error instanceof Error ? error.message : String(error),
);
```

**Testing:**

- Add test for malformed multipart boundary.
- Verify warning message appears.

---

## Important Issues

### 4. Missing Error Context in `extractHttpResponse`

**Location:** `src/http-adapter/shared/body.ts:256-320`

**Problem:** Generic error message "http_request did not return structured content" provides no debugging information.

**Implementation:**

```typescript
export interface ExtractResponseOptions {
  debug?: boolean;
}

export function extractHttpResponse(
  result: CallToolResult,
  options: ExtractResponseOptions = {},
): McpHttpResponse {
  const structured = (result as { structuredContent?: unknown })
    .structuredContent;

  if (structured && typeof structured === "object") {
    const status = (structured as { status?: unknown }).status;
    if (typeof status !== "number") {
      throw new Error(
        `http_request returned invalid response: missing or invalid 'status'. ` +
          `Got: ${preview(structured)}`,
      );
    }
    return structured as McpHttpResponse;
  }

  const text = extractTextContent(result);
  if (text) {
    const parsed = safeJsonParse(text, {
      context: "http_request response",
      debug: options.debug,
    });
    if (parsed && typeof parsed === "object") {
      const status = (parsed as { status?: unknown }).status;
      if (typeof status !== "number") {
        throw new Error(
          `http_request returned invalid response: missing or invalid 'status'. ` +
            `Parsed: ${preview(parsed)}`,
        );
      }
      return parsed as McpHttpResponse;
    }
    throw new Error(
      `http_request returned invalid response: expected object, got ${typeof parsed}. ` +
        `Raw text (truncated): ${truncate(text)}`,
    );
  }

  throw new Error(
    `http_request did not return structured content. ` +
      `structuredContent type: ${typeof structured}, ` +
      `content blocks: ${result.content?.length ?? 0}`,
  );
}
```

**Testing:**

- Add test for missing `status` field.
- Add test for non-object response.
- Add test for empty response.

---

### 5. Silent Field Skipping in `fieldsToFormData`

**Location:** `src/http-adapter/fetch-wrapper/fetch.ts:300-336`

**Problem:** Invalid form field entries are silently skipped without logging.

**Implementation:**

```typescript
function fieldsToFormData(body: unknown, debug?: boolean): FormData {
  const formData = new FormData();
  if (Array.isArray(body)) {
    let skipped = 0;
    for (let i = 0; i < body.length; i++) {
      const entry = body[i];
      if (!entry || typeof entry !== "object") {
        if (debug) {
          console.debug(`[MCP HTTP] Skipping invalid form field at index ${i}`);
        }
        skipped++;
        continue;
      }
      const field = entry as McpFormField;
      if (!field.name) {
        if (debug) {
          console.debug(
            `[MCP HTTP] Skipping form field at index ${i}: missing name`,
          );
        }
        skipped++;
        continue;
      }
      // ... rest of processing
    }
    if (skipped > 0 && debug) {
      console.debug(`[MCP HTTP] Skipped ${skipped} invalid form field(s).`);
    }
    return formData;
  }
  // ... rest of function
}
```

**Testing:**

- Add test for missing `name` property.
- Add test for non-object entries.
- Verify debug logging when enabled.

---

### 6. Inconsistent Forbidden Header Handling

**Location:**

- XHR: `xhr.ts:352-359` (warns)
- Fetch: `fetch.ts:502-506` (silent)

**Problem:** XHR logs a warning when forbidden headers are set, but fetch silently strips them.

**Implementation:** Make fetch match XHR behavior by warning when stripping forbidden headers:

```typescript
for (const forbidden of forbiddenHeaders) {
  if (headers.has(forbidden)) {
    console.warn(`Refused to set unsafe header "${forbidden}"`);
  }
  headers.delete(forbidden);
}
```

---

## Test Coverage Gaps to Address

### High Priority Tests

1. **Network failure in server-side proxy**
2. **Timeout handling**
3. **Malformed response handling**
4. **Concurrent XHR request isolation**

---

## Implementation Order

1. **Phase 1: Debug Controls + Error Context (Low Risk)**
   - Add `debug?: boolean` to options.
   - Update `safeJsonParse` and call sites.
   - Improve `extractHttpResponse` errors.
   - Add forbidden-header warning in fetch proxy.
   - Improve FormData fallback warning.

2. **Phase 2: XHR Error Context (Medium Risk)**
   - Add `_lastError` storage.
   - Gate XHR error logging behind `debug`.

3. **Phase 3: Tests**
   - Add tests for invalid JSON, malformed responses, and proxy failures.

---

## Rollback Plan

If issues are discovered after deployment:

1. All changes are additive (logging/context) and gated by `debug`.
2. Error message changes don\'t affect error handling logic.
3. New validation only rejects clearly invalid responses (missing `status`).

---

## Success Criteria

- [ ] All existing tests pass
- [ ] New error handling tests pass
- [ ] Debug logs appear only when `debug: true`
- [ ] No production-only globals required
- [ ] Type checking passes
