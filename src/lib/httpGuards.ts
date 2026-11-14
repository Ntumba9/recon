import type { NextRequest } from "next/server";

/**
 * Shared request-body guard for every route that accepts a body: streams
 * the body and aborts once it exceeds this many bytes, rather than trusting
 * a declared Content-Length (which a caller can spoof smaller than the
 * actual body, or omit entirely for a chunked request). 64 KB is far more
 * than any legitimate request body this app ever sends or receives.
 */
export const MAX_BODY_BYTES = 64 * 1024;

export type ReadBodyResult = { ok: true; raw: string } | { ok: false };

/**
 * Reads a request body as UTF-8 text, rejecting once more than `maxBytes`
 * have actually arrived on the stream - this is what makes the limit
 * resistant to a spoofed or absent Content-Length header, unlike checking
 * the header value alone. A request with no body at all reads as "".
 */
export async function readBodyWithLimit(req: NextRequest, maxBytes: number = MAX_BODY_BYTES): Promise<ReadBodyResult> {
  const reader = req.body?.getReader();
  if (!reader) {
    return { ok: true, raw: "" };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }

  return { ok: true, raw: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}

/**
 * True only when the request carries no Origin header (a non-browser
 * caller - curl, a script, server-to-server) or an Origin matching this
 * request's own host. This is a same-origin check, not authentication: it
 * stops a cross-origin browser page from driving these endpoints with the
 * browser's ambient state, nothing more. See README "Honest limits" for
 * the local-demo-only boundary this implies.
 *
 * Compared against the raw Host header, not req.nextUrl.host: behind a
 * port mapping (e.g. Docker's 3005:3000), nextUrl.host can reflect the
 * app's own internal binding instead of the host:port the browser actually
 * connected to, which would reject every real same-origin browser request.
 * The Host header is exactly what the client's connection target was.
 */
export function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True when the body (if any) is declared as JSON. An empty body passes regardless, so a no-body request (e.g. "trigger with defaults") isn't penalized for omitting Content-Type. */
export function hasJsonContentType(req: NextRequest, rawBody: string): boolean {
  if (rawBody.length === 0) return true;
  const contentType = req.headers.get("content-type") ?? "";
  return contentType.split(";")[0]!.trim().toLowerCase() === "application/json";
}
