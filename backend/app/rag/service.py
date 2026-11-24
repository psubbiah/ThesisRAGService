"""Thesis RAG: FAISS + OpenAI when keyed, lexical fallback otherwise."""

from __future__ import annotations

import logging
import os
import re
import time
from functools import lru_cache
from typing import Any

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import VECTORSTORE_DIR, get_settings
from app.models import QueryResponse, Source
from app.rag.corpus import load_thesis_documents
from app.thesis_meta import THESIS_AUTHOR, THESIS_TITLE, THESIS_YEAR

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = f"""You are the author of the thesis "{THESIS_TITLE}"
({THESIS_AUTHOR}, {THESIS_YEAR}). Answer using ONLY the provided context excerpts.
Speak in first person as the researcher. Keep answers concise (2–5 sentences) for spoken delivery.
If the context does not support an answer, say you cannot find that in the thesis material.
Do not invent citations or findings."""


class ThesisRagService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.documents = load_thesis_documents()
        self.chunks = self._split(self.documents)
        self.mode = "lexical"
        self._vectorstore = None
        self._retriever = None
        self._llm = None
        self._configure_tracing()
        self._maybe_init_embeddings()

    def _configure_tracing(self) -> None:
        key = self.settings.langsmith_key
        if key:
            os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
            os.environ.setdefault("LANGCHAIN_API_KEY", key)
            os.environ.setdefault("LANGCHAIN_PROJECT", self.settings.langchain_project)
            logger.info("LangSmith tracing enabled for project %s", self.settings.langchain_project)

    def _split(self, docs: list[Document]) -> list[Document]:
        splitter = RecursiveCharacterTextSplitter(chunk_size=900, chunk_overlap=120)
        return splitter.split_documents(docs)

    def _maybe_init_embeddings(self) -> None:
        api_key = self.settings.openai_api_key
        if not api_key:
            logger.warning("OPENAI_API_KEY missing — using lexical retrieval fallback")
            return
        try:
            from langchain_community.vectorstores import FAISS
            from langchain_openai import ChatOpenAI, OpenAIEmbeddings

            embeddings = OpenAIEmbeddings(
                model=self.settings.openai_embedding_model,
                api_key=api_key,
            )
            VECTORSTORE_DIR.mkdir(parents=True, exist_ok=True)
            index_path = VECTORSTORE_DIR / "faiss_index"
            if (index_path / "index.faiss").exists():
                self._vectorstore = FAISS.load_local(
                    str(index_path),
                    embeddings,
                    allow_dangerous_deserialization=True,
                )
            else:
                self._vectorstore = FAISS.from_documents(self.chunks, embeddings)
                self._vectorstore.save_local(str(index_path))
            self._retriever = self._vectorstore.as_retriever(
                search_kwargs={"k": self.settings.retrieval_k}
            )
            self._llm = ChatOpenAI(
                model=self.settings.openai_chat_model,
                temperature=0.2,
                api_key=api_key,
            )
            self.mode = "faiss+openai"
            logger.info("FAISS vector store ready (%s chunks)", len(self.chunks))
        except Exception:
            logger.exception("Failed to init embeddings; falling back to lexical mode")
            self.mode = "lexical"
            self._vectorstore = None
            self._retriever = None
            self._llm = None

    @property
    def documents_indexed(self) -> int:
        return len(self.chunks)

    def query(self, question: str) -> QueryResponse:
        started = time.perf_counter()
        docs = self._retrieve(question)
        answer = self._generate(question, docs)
        elapsed = time.perf_counter() - started
        sources = [
            Source(
                title=d.metadata.get("title") or d.metadata.get("source") or "Thesis excerpt",
                content=_excerpt(d.page_content),
                chapter=d.metadata.get("chapter"),
                chapter_title=d.metadata.get("chapter_title"),
                page=d.metadata.get("page") or d.metadata.get("page_start"),
                page_start=d.metadata.get("page_start"),
                page_end=d.metadata.get("page_end"),
                work=d.metadata.get("work"),
                citation=d.metadata.get("citation"),
                url=d.metadata.get("source"),
                score=d.metadata.get("score"),
            )
            for d in docs
        ]
        confidence = _confidence(docs, self.mode)
        return QueryResponse(
            answer=answer,
            sources=sources,
            confidence=confidence,
            metadata={
                "search_time": round(elapsed, 3),
                "documents_retrieved": len(docs),
                "rag_mode": self.mode,
                "query": question,
            },
        )

    def _retrieve(self, question: str) -> list[Document]:
        if self._retriever is not None:
            docs = list(self._retriever.invoke(question))
            for i, d in enumerate(docs):
                d.metadata["score"] = round(1.0 - i * 0.12, 3)
            return docs
        return self._lexical_retrieve(question)

    def _lexical_retrieve(self, question: str) -> list[Document]:
        tokens = _tokens(question)
        scored: list[tuple[float, Document]] = []
        for chunk in self.chunks:
            text = chunk.page_content.lower()
            overlap = sum(1 for t in tokens if t in text)
            if overlap:
                score = overlap / max(len(tokens), 1)
                scored.append((score, chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[: self.settings.retrieval_k]
        results: list[Document] = []
        for score, doc in top:
            enriched = Document(page_content=doc.page_content, metadata={**doc.metadata, "score": round(score, 3)})
            results.append(enriched)
        if not results:
            # Always return a little context so the avatar can still orient.
            for doc in self.chunks[:2]:
                results.append(
                    Document(
                        page_content=doc.page_content,
                        metadata={**doc.metadata, "score": 0.1},
                    )
                )
        return results

    def _generate(self, question: str, docs: list[Document]) -> str:
        context = "\n\n---\n\n".join(d.page_content for d in docs)
        if self._llm is not None:
            from langchain_core.messages import HumanMessage, SystemMessage

            messages = [
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(
                    content=f"Context:\n{context}\n\nQuestion: {question}\n\nAnswer:"
                ),
            ]
            response = self._llm.invoke(messages)
            content = getattr(response, "content", None) or str(response)
            return str(content).strip()
        return _extractive_answer(question, docs)


def _tokens(text: str) -> list[str]:
    stop = {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
        "what", "how", "why", "who", "when", "where", "your", "my", "about", "me",
        "this", "that", "with", "from", "do", "does", "did", "be", "was", "were",
    }
    return [t for t in re.findall(r"[a-z0-9']+", text.lower()) if t not in stop and len(t) > 2]


def _excerpt(text: str, limit: int = 280) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _confidence(docs: list[Document], mode: str) -> float:
    if not docs:
        return 0.2
    scores = [float(d.metadata.get("score") or 0.5) for d in docs]
    base = sum(scores) / len(scores)
    if mode.startswith("faiss"):
        return round(min(0.95, 0.55 + base * 0.4), 3)
    return round(min(0.85, 0.4 + base * 0.45), 3)


def _extractive_answer(question: str, docs: list[Document]) -> str:
    if not docs:
        return (
            "I couldn't find that in the thesis material I have loaded. "
            "Try asking about the research questions, methods, solidarity activists, or the diaspora interviews."
        )

    parts: list[str] = []
    for doc in docs[:2]:
        for block in doc.page_content.strip().split("\n\n"):
            cleaned = " ".join(
                line.lstrip("#").strip()
                for line in block.splitlines()
                if line.strip() and not line.strip().startswith("# ")
            )
            # Keep markdown headings' text when the block is only a heading
            if not cleaned:
                cleaned = " ".join(line.lstrip("#").strip() for line in block.splitlines())
            cleaned = " ".join(cleaned.split())
            if cleaned:
                parts.append(cleaned)
            if sum(len(p) for p in parts) > 380:
                break
        if sum(len(p) for p in parts) > 380:
            break

    body = " ".join(parts)
    if len(body) > 480:
        body = body[:479].rstrip() + "…"
    return f"Based on the thesis material: {body}"


@lru_cache
def get_rag_service() -> ThesisRagService:
    return ThesisRagService()
