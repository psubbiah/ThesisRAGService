# ThesisRAGService

Modern rebuild of the thesis Q&A avatar demo: **FastAPI + FAISS RAG** over
*Between Marxplaining and Solidarity: The Moral Logics of Venezuela's Populist Divide*,
spoken by an **Anam** avatar (custom photo likeness).

The historic HeyGen demo remains in [`psubbiah/heygen-rag-demo`](https://github.com/psubbiah/heygen-rag-demo) and is not modified by this project.

## Architecture

```
Browser (Next.js) ──► /api/rag-query ──► FastAPI :8000 /query
                 └──► /api/session-token ──► Anam
                 └──► Anam SDK talk(answer)
```

- Corpus: `backend/data/thesis/*.md` (distilled from the thesis notes)
- Vector store: **FAISS** when `OPENAI_API_KEY` is set; lexical fallback otherwise
- Avatar: Anam JS SDK, `avatarId` for your photo likeness
- Voice: stock Anam voice until an ElevenLabs clone is imported and set as `voiceId`

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cp .env.example frontend/.env.local
# set ANAM_API_KEY (and optionally OPENAI_API_KEY)

cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Ask

1. Click **Start** (needs `ANAM_API_KEY`)
2. Type a thesis question and click **Ask**
3. RAG answers in text; the avatar speaks them via `talk()`

Text-only Q&A works even if the avatar session is not started.

## Environment

| Variable | Where | Purpose |
|----------|--------|---------|
| `ANAM_API_KEY` | frontend | Session tokens for the avatar |
| `OPENAI_API_KEY` | backend | Embeddings + grounded answers |
| `LANGCHAIN_API_KEY` | backend | LangSmith tracing (optional) |
| `RAG_SERVICE_URL` | frontend | Default `http://127.0.0.1:8000` |

Persona IDs live in `frontend/src/config/persona.ts` (avatar likeness id is already set).

## API contract (compat with the old client)

`POST /query`

```json
{ "text": "What are the research questions?" }
```

also accepts `{ "query": "..." }`.

Response:

```json
{
  "answer": "...",
  "sources": [{ "title": "...", "content": "..." }],
  "confidence": 0.8,
  "metadata": {}
}
```

## Tests

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm run build
```

## Design

Simple Economist-inspired UI: Libre Baskerville + Source Sans 3, paper ground, red accent, one ask field, source footnotes — not the old HeyGen demo chrome.
