import { NextResponse } from "next/server";

import { requireIdentity } from "../../cursor/identity";

export const MAX_QUERY_CHARS = 500;
export const MAX_JSON_BYTES = 8_192;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function pruneBuckets(now: number) {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Simple per-viewer sliding window rate limit (in-memory; per instance). */
export function rateLimit(
  viewerKey: string,
  route: string,
  limit: number,
  windowMs = 60_000,
): NextResponse | null {
  const now = Date.now();
  pruneBuckets(now);
  const key = `${route}:${viewerKey}`;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  existing.count += 1;
  return null;
}

export async function requireAppViewer(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return identity;
  }
  return identity;
}

export function viewerKey(identity: { sub: string; kind?: string }): string {
  return `${identity.kind || "person"}:${identity.sub}`;
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body too large" },
        { status: 413 },
      ),
    };
  }
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }
}

/** Client-safe metadata only — no key shape or raw provider payloads. */
export function publicRagMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const error = metadata.openai_error;
  let openai_error: string | null = null;
  if (typeof error === "string" && error) {
    const lower = error.toLowerCase();
    if (lower.includes("not present")) openai_error = "missing_key";
    else if (lower.includes("401") || lower.includes("invalid_api_key"))
      openai_error = "invalid_api_key";
    else if (lower.includes("429") || lower.includes("quota"))
      openai_error = "quota_or_rate_limit";
    else if (lower.includes("timeout") || lower.includes("abort") || lower.includes("fetch"))
      openai_error = "upstream_unavailable";
    else openai_error = "synthesis_failed";
  }

  return {
    rag_mode: metadata.rag_mode ?? null,
    documents_retrieved: metadata.documents_retrieved ?? null,
    synthesized: Boolean(metadata.synthesized),
    openai_configured: Boolean(metadata.openai_configured),
    openai_error,
    via: metadata.via ?? null,
  };
}
