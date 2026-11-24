import { NextResponse } from "next/server";

import { describeApiKeyShape, readServerEnv } from "@/lib/serverEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight probe: confirms whether OPENAI_API_KEY is present and accepted
 * by OpenAI. Never returns the key itself.
 */
export async function GET() {
  const apiKey = readServerEnv("OPENAI_API_KEY");
  const shape = describeApiKeyShape(apiKey);

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      openai: {
        configured: false,
        probe: "skipped",
        key_shape: shape,
        error: "OPENAI_API_KEY not present in server environment",
      },
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errJson = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        detail = errJson.error?.code || errJson.error?.message?.slice(0, 120) || "";
      } catch {
        detail = (await response.text()).slice(0, 120);
      }
      return NextResponse.json({
        ok: false,
        openai: {
          configured: true,
          probe: "failed",
          status: response.status,
          key_shape: shape,
          error: detail || `HTTP ${response.status}`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      openai: {
        configured: true,
        probe: "ok",
        status: response.status,
        key_shape: shape,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      openai: {
        configured: true,
        probe: "error",
        key_shape: shape,
        error: error instanceof Error ? error.message : "unknown error",
      },
    });
  }
}
