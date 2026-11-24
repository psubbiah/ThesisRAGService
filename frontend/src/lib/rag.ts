import { THESIS_TITLE } from "@/config/thesis";

export type RagSource = {
  title: string;
  content: string;
  chapter?: number | null;
  chapter_title?: string | null;
  page?: number | null;
  page_start?: number | null;
  page_end?: number | null;
  work?: string | null;
  citation?: string | null;
  url?: string | null;
  score?: number | null;
};

export type RagResponse = {
  answer: string;
  sources: RagSource[];
  confidence: number;
  metadata?: Record<string, unknown>;
  error?: string;
  details?: string;
};

/** Plain-text snippet for Sources panel (strips markdown hashes/lists). */
export function formatSourceSnippet(content: string, limit = 320): string {
  const cleaned = content
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
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`;
}

export function formatSourceLabel(source: RagSource): string {
  if (source.citation) return source.citation;

  const parts: string[] = [];
  parts.push(source.work || THESIS_TITLE);

  if (source.chapter != null) {
    const chapterName = source.chapter_title || source.title;
    parts.push(`Ch. ${source.chapter}: ${chapterName}`);
  } else if (source.chapter_title || source.title) {
    parts.push(source.chapter_title || source.title);
  }

  const start = source.page_start ?? source.page;
  const end = source.page_end ?? start;
  if (start != null) {
    parts.push(end != null && end !== start ? `pp. ${start}–${end}` : `p. ${start}`);
  }

  return parts.join(" · ");
}

export async function queryRag(question: string): Promise<RagResponse> {
  const response = await fetch("/api/rag-query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: question }),
  });

  const data = (await response.json()) as RagResponse;
  if (!response.ok) {
    throw new Error(data.error || data.details || "RAG request failed");
  }
  return data;
}
