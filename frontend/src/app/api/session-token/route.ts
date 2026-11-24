import { NextResponse } from "next/server";

import { buildAnamPersonaConfig } from "@/lib/anamPersona";
import { readServerEnv } from "@/lib/serverEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = readServerEnv("ANAM_API_KEY");

  if (!apiKey) {
    return NextResponse.json(
      { error: "ANAM_API_KEY is not configured" },
      { status: 500 },
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
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json({
      sessionToken: data.sessionToken,
      // Non-secret diagnostics so we can see which path is live.
      mode: "personaId" in personaConfig ? "saved-persona" : "ephemeral",
    });
  } catch (error) {
    console.error("Error fetching session token:", error);
    return NextResponse.json(
      { error: "Failed to get session token" },
      { status: 500 },
    );
  }
}
