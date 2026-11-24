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
