import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["documents_indexed"] > 0


def test_query_with_text_field():
    res = client.post("/query", json={"text": "What are the research questions?"})
    assert res.status_code == 200
    data = res.json()
    assert data["answer"]
    assert isinstance(data["sources"], list)
    assert "confidence" in data
    assert data["sources"]
    first = data["sources"][0]
    assert first.get("chapter") is not None
    assert first.get("citation")
    assert "Ch." in first["citation"]


def test_query_with_query_field():
    res = client.post("/query", json={"query": "Tell me about solidarity activists"})
    assert res.status_code == 200
    assert "answer" in res.json()


def test_query_requires_input():
    res = client.post("/query", json={})
    assert res.status_code == 422
