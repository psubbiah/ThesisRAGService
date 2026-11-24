export type RagSource = {
  title: string;
  content: string;
  page?: number | null;
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
