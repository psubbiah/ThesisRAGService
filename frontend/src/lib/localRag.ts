import fs from "fs";
import path from "path";

import { THESIS_TITLE } from "@/config/thesis";
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

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "what", "how", "why", "who", "when", "where", "your", "my", "about", "me",
  "this", "that", "with", "from", "do", "does", "did", "be", "was", "were",
]);

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

export function localThesisQuery(question: string): RagResponse {
  const docs = loadDocs();
  const qTokens = tokens(question);
  const scored = docs
    .map((doc) => {
      const hay = doc.content.toLowerCase();
      const overlap = qTokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
      return { doc, score: overlap / Math.max(qTokens.length, 1) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const chosen =
    scored.length > 0
      ? scored
      : docs.slice(0, 2).map((doc) => ({ doc, score: 0.1 }));

  const sources: RagSource[] = chosen.map(({ doc, score }) => ({
    title: doc.title,
    content: excerpt(doc.content),
    chapter: doc.chapter,
    chapter_title: doc.chapter_title,
    page: doc.page_start,
    page_start: doc.page_start,
    page_end: doc.page_end,
    work: doc.work,
    citation: doc.citation,
    url: doc.source,
    score: Number(score.toFixed(3)),
  }));

  const parts: string[] = [];
  for (const { doc } of chosen.slice(0, 2)) {
    for (const block of doc.content.split(/\n\n+/)) {
      const cleaned = block
        .split("\n")
        .map((line) => line.replace(/^#+\s*/, "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) parts.push(cleaned);
      if (parts.join(" ").length > 380) break;
    }
    if (parts.join(" ").length > 380) break;
  }
  let body = parts.join(" ");
  if (body.length > 480) body = `${body.slice(0, 479)}…`;

  return {
    answer: `Based on the thesis material: ${body}`,
    sources,
    confidence: scored.length
      ? Math.min(0.85, 0.4 + scored[0].score * 0.45)
      : 0.25,
    metadata: {
      rag_mode: "local-lexical",
      documents_retrieved: sources.length,
      query: question,
    },
  };
}
