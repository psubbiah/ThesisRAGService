from typing import Any

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    """Accept both legacy avatar clients (`text`) and modern clients (`query`)."""

    text: str | None = None
    query: str | None = None

    def resolved_query(self) -> str:
        value = (self.query or self.text or "").strip()
        if not value:
            raise ValueError("Either 'query' or 'text' is required")
        return value


class Source(BaseModel):
    title: str
    content: str
    page: int | None = None
    url: str | None = None
    score: float | None = None


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source] = Field(default_factory=list)
    confidence: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    service: str
    rag_mode: str
    documents_indexed: int
    langsmith_enabled: bool
