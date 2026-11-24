import { NextResponse } from "next/server";

import {
  rateLimit,
  requireAppViewer,
  viewerKey,
} from "@/lib/apiGuard";
import { buildAnamPersonaConfig } from "@/lib/anamPersona";
import { readServerEnv } from "@/lib/serverEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireAppViewer(request);
  if (identity instanceof Response) return identity;

  const limited = rateLimit(viewerKey(identity), "session-token", 10);
  if (limited) return limited;

  const apiKey = readServerEnv("ANAM_API_KEY");
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANAM_API_KEY is not configured" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const personaConfig = buildAnamPersonaConfig();

  try {
    const response = await fetch("https://api.anam.ai/v1/auth/session-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ personaConfig }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Anam API error:", error.slice(0, 300));
      return NextResponse.json(
        { error: "Failed to get session token" },
        {
          status: response.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    const data = await response.json();
    return NextResponse.json(
      { sessionToken: data.sessionToken },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Error fetching session token:", error);
    return NextResponse.json(
      { error: "Failed to get session token" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
