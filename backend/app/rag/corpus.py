from pathlib import Path

from langchain_core.documents import Document

from app.config import DATA_DIR


def load_thesis_documents(data_dir: Path | None = None) -> list[Document]:
    root = data_dir or DATA_DIR
    if not root.exists():
        raise FileNotFoundError(f"Thesis data directory not found: {root}")

    documents: list[Document] = []
    for path in sorted(root.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        title = _title_from_markdown(text) or path.stem.replace("_", " ").title()
        documents.append(
            Document(
                page_content=text,
                metadata={
                    "title": title,
                    "source": path.name,
                    "path": str(path),
                },
            )
        )
    if not documents:
        raise RuntimeError(f"No thesis markdown documents found in {root}")
    return documents


def _title_from_markdown(text: str) -> str | None:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return None
