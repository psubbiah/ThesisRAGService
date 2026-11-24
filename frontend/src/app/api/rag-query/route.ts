import { NextResponse } from "next/server";

import {
  MAX_QUERY_CHARS,
  publicRagMetadata,
  rateLimit,
  readJsonBody,
  requireAppViewer,
  viewerKey,
} from "@/lib/apiGuard";
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

export async function POST(request: Request) {
  const identity = await requireAppViewer(request);
  if (identity instanceof Response) return identity;

  const limited = rateLimit(viewerKey(identity), "rag-query", 20);
  if (limited) return limited;

  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;

    const body = (parsed.body || {}) as {
      query?: unknown;
      text?: unknown;
    };
    const query = String(body.query || body.text || "").trim();

    if (!query) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (query.length > MAX_QUERY_CHARS) {
      return NextResponse.json(
        {
          error: `Query too long (max ${MAX_QUERY_CHARS} characters)`,
        },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
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
          return NextResponse.json(
            {
              answer,
              sources:
                ragData.sources ||
                ragData.documents ||
                ragData.references ||
                [],
              confidence:
                ragData.confidence ??
                ragData.score ??
                ragData.certainty ??
                1.0,
              metadata: publicRagMetadata({
                ...(ragData.metadata || ragData.meta || {}),
                via: "fastapi",
              }),
            },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        }
      } catch (error) {
        console.warn(
          "FastAPI RAG unavailable, using local thesis corpus:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Prefer THESIS_OPENAI_API_KEY so a fresh App Secret can replace a stale
    // OPENAI_API_KEY value that Cursor kept re-binding.
    const openaiApiKey =
      readServerEnv("THESIS_OPENAI_API_KEY") || readServerEnv("OPENAI_API_KEY");
    const openaiChatModel = readServerEnv("OPENAI_CHAT_MODEL") || "gpt-4o-mini";

    const local = await localThesisQuery(query, {
      openaiApiKey,
      openaiChatModel,
    });

    return NextResponse.json(
      {
        answer: local.answer,
        sources: local.sources,
        confidence: local.confidence,
        metadata: publicRagMetadata({
          ...local.metadata,
          via:
            local.metadata?.rag_mode === "local-openai"
              ? "local-openai"
              : "local-lexical",
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
