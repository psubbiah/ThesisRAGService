import { NextRequest, NextResponse } from "next/server";

import { localThesisQuery } from "@/lib/localRag";
import { readServerEnv } from "@/lib/serverEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 8000);

async function queryBackend(question: string, baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ text: question }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`RAG service ${response.status}: ${details}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = (body.query || body.text || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Only hit FastAPI when explicitly configured — hosted apps must not
    // stall on a default localhost backend that does not exist.
    const ragServiceUrl = readServerEnv("RAG_SERVICE_URL");
    if (ragServiceUrl) {
      try {
        const ragData = await queryBackend(query, ragServiceUrl);
        const answer =
          ragData.answer ||
          ragData.response ||
          ragData.content ||
          ragData.result ||
          ragData.text;

        if (answer) {
          return NextResponse.json({
            answer,
            sources:
              ragData.sources || ragData.documents || ragData.references || [],
            confidence:
              ragData.confidence ?? ragData.score ?? ragData.certainty ?? 1.0,
            metadata: {
              ...(ragData.metadata || ragData.meta || {}),
              via: "fastapi",
            },
          });
        }
      } catch (error) {
        console.warn(
          "FastAPI RAG unavailable, using local thesis corpus:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const openaiApiKey = readServerEnv("OPENAI_API_KEY");
    const openaiChatModel = readServerEnv("OPENAI_CHAT_MODEL") || "gpt-4o-mini";

    const local = await localThesisQuery(query, {
      openaiApiKey,
      openaiChatModel,
    });

    return NextResponse.json({
      ...local,
      metadata: {
        ...local.metadata,
        via:
          local.metadata?.rag_mode === "local-openai"
            ? "local-openai"
            : "local-lexical",
      },
    });
  } catch (error) {
    console.error("Error querying RAG:", error);
    return NextResponse.json(
      {
        answer:
          "I apologise — I could not search the thesis knowledge base just now.",
        error: "Failed to query RAG service",
        sources: [],
        confidence: 0,
      },
      { status: 500 },
    );
  }
}
