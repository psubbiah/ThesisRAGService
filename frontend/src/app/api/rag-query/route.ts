import { NextRequest, NextResponse } from "next/server";

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL || "http://127.0.0.1:8000";
const TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 30000);

const FALLBACK =
  "I apologise — I could not reach the thesis knowledge base just now. Please try again in a moment.";

async function queryBackend(question: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${RAG_SERVICE_URL}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Match the original working client contract
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

    const ragData = await queryBackend(query);
    const answer =
      ragData.answer ||
      ragData.response ||
      ragData.content ||
      ragData.result ||
      ragData.text;

    if (!answer) {
      return NextResponse.json({
        answer: FALLBACK,
        sources: [],
        confidence: 0,
        warning: "No answer found in RAG response",
      });
    }

    return NextResponse.json({
      answer,
      sources: ragData.sources || ragData.documents || ragData.references || [],
      confidence:
        ragData.confidence ?? ragData.score ?? ragData.certainty ?? 1.0,
      metadata: ragData.metadata || ragData.meta || {},
    });
  } catch (error) {
    console.error("Error querying RAG service:", error);
    return NextResponse.json(
      {
        answer: FALLBACK,
        error: "Failed to query RAG service",
        details: error instanceof Error ? error.message : "Unknown error",
        sources: [],
        confidence: 0,
      },
      { status: 200 },
    );
  }
}
