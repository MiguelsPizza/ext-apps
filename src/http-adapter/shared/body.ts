/**
 * Body serialization helpers shared across HTTP adapters.
 */
import type { McpBodyType, McpFormField } from "./http-types.js";
import { safeJsonParse } from "./json.js";

/**
 * Encodes a Uint8Array to a base64 string.
 */
export function toBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("Base64 encoding is not supported in this environment");
}

/**
 * Decodes a base64 string to a Uint8Array.
 */
export function fromBase64(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  throw new Error("Base64 decoding is not supported in this environment");
}

/**
 * Converts FormData to an array of serializable form fields.
 */
export async function formDataToFields(
  formData: FormData,
): Promise<McpFormField[]> {
  const fields: McpFormField[] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
      continue;
    }
    // value is a File (which extends Blob)
    const file = value as File;
    const buffer = await file.arrayBuffer();
    fields.push({
      name,
      data: toBase64(new Uint8Array(buffer)),
      filename: file.name,
      contentType: file.type || undefined,
    });
  }
  return fields;
}

/**
 * Serializes a string body based on content-type.
 */
export function serializeStringBody(
  body: string,
  contentType: string | null,
): { body?: unknown; bodyType?: McpBodyType } {
  const normalizedType = (contentType ?? "").toLowerCase();
  if (normalizedType.includes("application/json")) {
    const parsed = safeJsonParse(body);
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
  }
  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body };
  }
  return { bodyType: "text", body };
}

/**
 * Serializes a request body from a body init value.
 */
export async function serializeBodyInit(
  body: BodyInit | XMLHttpRequestBodyInit | Document | null,
  contentType: string | null,
  options: { allowDocument?: boolean } = {},
): Promise<{ body?: unknown; bodyType?: McpBodyType }> {
  if (body == null) {
    return { bodyType: "none", body: undefined };
  }

  if (typeof body === "string") {
    return serializeStringBody(body, contentType);
  }

  if (
    options.allowDocument &&
    typeof Document !== "undefined" &&
    body instanceof Document
  ) {
    const serializer = new XMLSerializer();
    return {
      bodyType: "text",
      body: serializer.serializeToString(body),
    };
  }

  if (
    options.allowDocument &&
    body &&
    typeof body === "object" &&
    "documentElement" in body &&
    typeof XMLSerializer !== "undefined"
  ) {
    const serializer = new XMLSerializer();
    return {
      bodyType: "text",
      body: serializer.serializeToString(body as Document),
    };
  }

  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return { bodyType: "urlEncoded", body: body.toString() };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { bodyType: "formData", body: await formDataToFields(body) };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    const buffer = await body.arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  if (body instanceof ArrayBuffer) {
    return { bodyType: "base64", body: toBase64(new Uint8Array(body)) };
  }

  if (ArrayBuffer.isView(body)) {
    const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return { bodyType: "base64", body: toBase64(view) };
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    const buffer = await new Response(body).arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  return { bodyType: "text", body: String(body) };
}

/**
 * Serializes a request body from a Request instance.
 */
export async function serializeBodyFromRequest(
  request: Request,
  contentType: string | null,
): Promise<{ body?: unknown; bodyType?: McpBodyType }> {
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedType.includes("application/json")) {
    const text = await request.text();
    const parsed = safeJsonParse(text);
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
    return { bodyType: "text", body: text };
  }

  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body: await request.text() };
  }

  if (
    normalizedType.includes("multipart/form-data") &&
    typeof request.formData === "function"
  ) {
    try {
      const formData = await request.formData();
      return { bodyType: "formData", body: await formDataToFields(formData) };
    } catch (error) {
      console.warn(
        "Failed to parse multipart/form-data, falling back to binary encoding:",
        error instanceof Error ? error.message : String(error),
      );
      // Fall through to text/binary handling.
    }
  }

  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("application/xml") ||
    normalizedType.includes("application/javascript")
  ) {
    return { bodyType: "text", body: await request.text() };
  }

  const buffer = await request.arrayBuffer();
  return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
}
