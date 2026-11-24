from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from langchain_core.documents import Document

from app.config import DATA_DIR

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.DOTALL)


def load_thesis_documents(data_dir: Path | None = None) -> list[Document]:
    root = data_dir or DATA_DIR
    if not root.exists():
        raise FileNotFoundError(f"Thesis data directory not found: {root}")

    documents: list[Document] = []
    for path in sorted(root.glob("*.md")):
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            continue

        meta, body = _split_frontmatter(raw)
        title = (
            meta.get("section")
            or _title_from_markdown(body)
            or path.stem.replace("_", " ").title()
        )
        chapter = _as_int(meta.get("chapter"))
        chapter_title = meta.get("chapter_title") or title
        page_start = _as_int(meta.get("page_start"))
        page_end = _as_int(meta.get("page_end")) or page_start
        work = meta.get("work") or "Radical imaginaries of the Bolivarian Revolution"

        documents.append(
            Document(
                page_content=body.strip(),
                metadata={
                    "title": str(title),
                    "chapter": chapter,
                    "chapter_title": str(chapter_title),
                    "page": page_start,
                    "page_start": page_start,
                    "page_end": page_end,
                    "work": str(work),
                    "source": path.name,
                    "path": str(path),
                    "citation": _format_citation(
                        work=str(work),
                        chapter=chapter,
                        chapter_title=str(chapter_title),
                        page_start=page_start,
                        page_end=page_end,
                    ),
                },
            )
        )
    if not documents:
        raise RuntimeError(f"No thesis markdown documents found in {root}")
    return documents


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: dict[str, Any] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, match.group(2)


def _title_from_markdown(text: str) -> str | None:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return None


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _format_citation(
    *,
    work: str,
    chapter: int | None,
    chapter_title: str,
    page_start: int | None,
    page_end: int | None,
) -> str:
    parts: list[str] = [work]
    if chapter is not None:
        parts.append(f"Ch. {chapter}: {chapter_title}")
    elif chapter_title:
        parts.append(chapter_title)
    if page_start is not None:
        if page_end is not None and page_end != page_start:
            parts.append(f"pp. {page_start}–{page_end}")
        else:
            parts.append(f"p. {page_start}")
    return " · ".join(parts)
