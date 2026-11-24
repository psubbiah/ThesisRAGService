import fs from "fs";
import path from "path";

import { THESIS_AUTHOR, THESIS_TITLE } from "@/config/thesis";
import type { RagResponse, RagSource } from "@/lib/rag";

type Doc = {
  title: string;
  chapter: number | null;
  chapter_title: string;
  page_start: number | null;
  page_end: number | null;
  work: string;
  citation: string;
  source: string;
  content: string;
};

type Chunk = Doc & {
  chunkId: string;
  text: string;
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "what", "how", "why", "who", "when", "where", "your", "my", "about", "me",
  "this", "that", "with", "from", "do", "does", "did", "be", "was", "were",
  "can", "you", "tell", "please", "could", "would", "should", "into",
]);

const SYSTEM_PROMPT = `You are ${THESIS_AUTHOR}, author of the thesis "${THESIS_TITLE}".
Answer using ONLY the provided context excerpts from that thesis.
Speak in the first person as the researcher.
Write 2–5 clear spoken sentences — paraphrase and synthesise; do not read the context verbatim or paste bullet lists.
If the context does not support an answer, say you cannot find that in the thesis material.
Do not invent citations, interviews, or findings.`;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

function titleFromBody(body: string): string | null {
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function asInt(value?: string): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function formatCitation(doc: Omit<Doc, "content" | "source" | "citation">): string {
  const parts = [doc.work];
  if (doc.chapter != null) parts.push(`Ch. ${doc.chapter}: ${doc.chapter_title}`);
  else if (doc.chapter_title) parts.push(doc.chapter_title);
  if (doc.page_start != null) {
    parts.push(
      doc.page_end != null && doc.page_end !== doc.page_start
        ? `pp. ${doc.page_start}–${doc.page_end}`
        : `p. ${doc.page_start}`,
    );
  }
  return parts.join(" · ");
}

function loadDocs(): Doc[] {
  const dir = path.join(process.cwd(), "content", "thesis");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const title = meta.section || titleFromBody(body) || file;
      const chapter = asInt(meta.chapter);
      const chapter_title = meta.chapter_title || title;
      const page_start = asInt(meta.page_start);
      const page_end = asInt(meta.page_end) ?? page_start;
      const work = meta.work || THESIS_TITLE;
      const base = {
        title,
        chapter,
        chapter_title,
        page_start,
        page_end,
        work,
      };
      return {
        ...base,
        source: file,
        content: body.trim(),
        citation: formatCitation(base),
      };
    });
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (t) => !STOP.has(t) && t.length > 2,
  );
}

function excerpt(text: string, limit = 280): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function chunkDoc(doc: Doc, size = 700, overlap = 120): Chunk[] {
  const plain = doc.content.replace(/\r\n/g, "\n").trim();
  if (plain.length <= size) {
    return [{ ...doc, chunkId: `${doc.source}:0`, text: plain }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < plain.length) {
    let end = Math.min(start + size, plain.length);
    if (end < plain.length) {
      const slice = plain.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
      );
      if (breakAt > size * 0.45) end = start + breakAt + 1;
    }
    const text = plain.slice(start, end).trim();
    if (text) {
      chunks.push({ ...doc, chunkId: `${doc.source}:${index}`, text });
      index += 1;
    }
    if (end >= plain.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function termWeight(term: string, corpus: Chunk[]): number {
  // Rare thesis terms (sanctions, diaspora, ethnography…) beat generic ones.
  const df = corpus.reduce(
    (n, c) => n + (c.text.toLowerCase().includes(term) ? 1 : 0),
    0,
  );
  return Math.log(1 + corpus.length / Math.max(df, 1));
}

function scoreChunk(
  qTokens: string[],
  chunk: Chunk,
  weights: Map<string, number>,
): number {
  const hay = chunk.text.toLowerCase();
  const titleHay = `${chunk.title} ${chunk.chapter_title}`.toLowerCase();
  if (!qTokens.length) return 0;

  let hitWeight = 0;
  let totalWeight = 0;
  let density = 0;

  for (const t of qTokens) {
    const w = weights.get(t) || 1;
    totalWeight += w;
    if (hay.includes(t)) {
      hitWeight += w;
      const count = hay.split(t).length - 1;
      density += w * Math.min(count, 5);
    }
    if (titleHay.includes(t)) {
      hitWeight += w * 0.35;
      density += w * 0.8;
    }
  }

  const coverage = hitWeight / Math.max(totalWeight, 1e-6);
  const dens = density / (qTokens.length * 4);

  // Prefer topic chapters over the overview when coverage is only partial.
  const introPenalty =
    chunk.source.startsWith("01_") && coverage < 0.7 ? 0.22 : 0;

  return coverage * 0.55 + dens * 0.45 - introPenalty;
}

function retrieveChunks(question: string, k = 5): { chunk: Chunk; score: number }[] {
  const docs = loadDocs();
  const allChunks = docs.flatMap((doc) => chunkDoc(doc));
  const qTokens = tokens(question);
  const weights = new Map(qTokens.map((t) => [t, termWeight(t, allChunks)]));

  const scored = allChunks
    .map((chunk) => ({ chunk, score: scoreChunk(qTokens, chunk, weights) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score);

  // Diversify by source file so answers aren't stuck in one chapter.
  const picked: { chunk: Chunk; score: number }[] = [];
  const perSource = new Map<string, number>();
  for (const item of scored) {
    const used = perSource.get(item.chunk.source) || 0;
    if (used >= 2) continue;
    picked.push(item);
    perSource.set(item.chunk.source, used + 1);
    if (picked.length >= k) break;
  }

  if (picked.length > 0) return picked;

  // Soft fallback: middle chapters rather than always intro.
  const mid = allChunks.filter((c) => !c.source.startsWith("01_")).slice(0, k);
  const fallback = (mid.length ? mid : allChunks.slice(0, k)).map((chunk) => ({
    chunk,
    score: 0.1,
  }));
  return fallback;
}

function toSources(
  chosen: { chunk: Chunk; score: number }[],
): RagSource[] {
  return chosen.map(({ chunk, score }) => ({
    title: chunk.title,
    // Plain-text snippet for the UI — raw markdown hashes looked broken in Sources.
    content: cleanExcerpt(chunk.text, 320),
    chapter: chunk.chapter,
    chapter_title: chunk.chapter_title,
    page: chunk.page_start,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    work: chunk.work,
    citation: chunk.citation,
    url: chunk.source,
    score: Number(score.toFixed(3)),
  }));
}

function cleanExcerpt(text: string, limit = 220): string {
  const cleaned = text
    // Keep heading/list wording; strip markdown markers so Sources read as prose.
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+#{1,6}\s+/g, ". ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+[-*+]\s+/g, ". ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")
    .trim();
  return excerpt(cleaned, limit);
}

/** Spoken-safe fallback when the model is briefly unavailable (non-auth errors). */
function extractiveAnswer(
  chosen: { chunk: Chunk; score: number }[],
): string {
  if (!chosen.length) {
    return (
      "I couldn't find that in the thesis material I have loaded. " +
      "Try asking about the research questions, methods, solidarity activists, or the diaspora interviews."
    );
  }
  const bits = chosen.slice(0, 2).map(({ chunk }) => cleanExcerpt(chunk.text, 180));
  return (
    "Drawing briefly from the thesis notes: " +
    bits.join(" ") +
    " I can say more once the language model is available again."
  );
}

function spokenFailureMessage(openaiError: string, hasKey: boolean): string {
  const lower = openaiError.toLowerCase();
  if (!hasKey) {
    return (
      "I found the thesis material, but the OpenAI key is not available to this app yet, " +
      "so I cannot paraphrase an answer. Please set OPENAI_API_KEY in App Secrets and try again."
    );
  }
  if (
    lower.includes("401") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key")
  ) {
    return (
      "I found the thesis material, but OpenAI rejected the API key as invalid. " +
      "This is not an avatar problem — please replace OPENAI_API_KEY in Cursor App Secrets " +
      "with a fresh key from platform.openai.com, then ask again."
    );
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate")) {
    return (
      "I found the thesis material, but the OpenAI account hit a rate or quota limit. " +
      "Please check billing and limits, then try again."
    );
  }
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("fetch failed")) {
    return (
      "I found the thesis material, but I could not reach OpenAI just now. Please try again in a moment."
    );
  }
  return (
    "I found the thesis material, but the language model could not compose an answer just now. " +
    "Please try again shortly."
  );
}

function isAuthOrConfigFailure(openaiError: string, hasKey: boolean): boolean {
  if (!hasKey) return true;
  const lower = openaiError.toLowerCase();
  return (
    lower.includes("401") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key") ||
    lower.includes("429") ||
    lower.includes("quota")
  );
}

async function synthesizeWithOpenAI(
  question: string,
  chosen: { chunk: Chunk; score: number }[],
  apiKey: string,
  model: string,
): Promise<string> {
  const context = chosen
    .map(
      ({ chunk }, i) =>
        `[Excerpt ${i + 1} | ${chunk.citation}]\n${chunk.text}`,
    )
    .join("\n\n---\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 320,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`,
          },
        ],
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errJson = (await response.json()) as {
          error?: { message?: string; code?: string; type?: string };
        };
        detail =
          errJson.error?.code ||
          errJson.error?.type ||
          errJson.error?.message?.slice(0, 120) ||
          "";
      } catch {
        detail = (await response.text()).slice(0, 120);
      }
      throw new Error(`OpenAI HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("OpenAI returned an empty answer");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export type LocalThesisOptions = {
  openaiApiKey?: string;
  openaiChatModel?: string;
};

export async function localThesisQuery(
  question: string,
  options: LocalThesisOptions = {},
): Promise<RagResponse> {
  const chosen = retrieveChunks(question, 5);
  const sources = toSources(chosen);
  const apiKey = options.openaiApiKey?.trim();
  const model = options.openaiChatModel || "gpt-4o-mini";

  let answer: string;
  let mode = "local-lexical";
  let openaiError: string | undefined;

  if (apiKey) {
    try {
      answer = await synthesizeWithOpenAI(question, chosen, apiKey, model);
      mode = "local-openai";
    } catch (error) {
      openaiError = error instanceof Error ? error.message : "unknown error";
      console.warn("OpenAI synthesis failed:", openaiError);
      // Auth/config failures: say so clearly. Do not read thesis excerpts —
      // that made it look like an avatar/RAG wiring bug.
      if (isAuthOrConfigFailure(openaiError, true)) {
        answer = spokenFailureMessage(openaiError, true);
        mode = "openai-auth-failed";
      } else {
        answer = extractiveAnswer(chosen);
        mode = "local-lexical-fallback";
      }
    }
  } else {
    openaiError = "OPENAI_API_KEY not present in server environment";
    answer = spokenFailureMessage(openaiError, false);
    mode = "openai-missing";
  }

  return {
    answer,
    sources,
    confidence: chosen.length
      ? Math.min(0.92, 0.45 + chosen[0].score * 0.5)
      : 0.25,
    metadata: {
      rag_mode: mode,
      documents_retrieved: sources.length,
      query: question,
      synthesized: mode === "local-openai",
      openai_configured: Boolean(apiKey),
      openai_error: openaiError || null,
    },
  };
}
