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
    content: excerpt(chunk.text),
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

function extractiveAnswer(
  question: string,
  chosen: { chunk: Chunk; score: number }[],
): string {
  if (!chosen.length) {
    return (
      "I couldn't find that in the thesis material I have loaded. " +
      "Try asking about the research questions, methods, solidarity activists, or the diaspora interviews."
    );
  }
  const bits = chosen.slice(0, 2).map(({ chunk }) => {
    const cleaned = chunk.text
      .replace(/^#+\s*.+$/gm, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*\d+\.\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    return excerpt(cleaned, 220);
  });
  return (
    "From the thesis notes: " +
    bits.join(" ") +
    " (OpenAI synthesis unavailable — add OPENAI_API_KEY for a spoken paraphrase.)"
  );
}

async function synthesizeWithOpenAI(
  question: string,
  chosen: { chunk: Chunk; score: number }[],
  apiKey: string,
): Promise<string> {
  const context = chosen
    .map(
      ({ chunk }, i) =>
        `[Excerpt ${i + 1} | ${chunk.citation}]\n${chunk.text}`,
    )
    .join("\n\n---\n\n");

  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
    const errText = await response.text();
    throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI returned an empty answer");
  return content;
}

export async function localThesisQuery(question: string): Promise<RagResponse> {
  const chosen = retrieveChunks(question, 5);
  const sources = toSources(chosen);
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  let answer: string;
  let mode = "local-lexical";

  if (apiKey) {
    try {
      answer = await synthesizeWithOpenAI(question, chosen, apiKey);
      mode = "local-openai";
    } catch (error) {
      console.warn(
        "OpenAI synthesis failed; falling back to extractive answer:",
        error instanceof Error ? error.message : error,
      );
      answer = extractiveAnswer(question, chosen);
      mode = "local-lexical-fallback";
    }
  } else {
    answer = extractiveAnswer(question, chosen);
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
    },
  };
}
