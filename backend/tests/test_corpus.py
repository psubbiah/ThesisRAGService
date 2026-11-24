import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.rag.corpus import load_thesis_documents  # noqa: E402


def test_loads_thesis_markdown():
    docs = load_thesis_documents()
    assert len(docs) >= 7
    titles = " ".join(d.metadata["title"] for d in docs).lower()
    assert "bolivarian" in titles or "research" in titles


def test_documents_include_chapter_and_pages():
    docs = load_thesis_documents()
    with_chapter = [d for d in docs if d.metadata.get("chapter") is not None]
    assert with_chapter
    sample = with_chapter[0]
    assert sample.metadata.get("chapter_title")
    assert sample.metadata.get("page_start") is not None
    assert "Ch." in (sample.metadata.get("citation") or "")
    assert "pp." in (sample.metadata.get("citation") or "") or "p." in (
        sample.metadata.get("citation") or ""
    )
