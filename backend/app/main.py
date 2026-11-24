import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.models import HealthResponse, QueryRequest, QueryResponse
from app.rag import get_rag_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("thesis-rag")


@asynccontextmanager
async def lifespan(_: FastAPI):
    service = get_rag_service()
    logger.info(
        "Thesis RAG ready — mode=%s docs=%s",
        service.mode,
        service.documents_indexed,
    )
    yield


settings = get_settings()
app = FastAPI(
    title="Thesis RAG Service",
    version="2.0.0",
    description="RAG over Radical imaginaries of the Bolivarian Revolution for Anam avatar Q&A",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["meta"])
def root() -> dict:
    service = get_rag_service()
    return {
        "service": "Thesis RAG Service",
        "version": "2.0.0",
        "endpoints": {"query": "/query", "health": "/health"},
        "rag_mode": service.mode,
        "description": "RAG for Anam thesis avatar — accepts {text} or {query}",
    }


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    service = get_rag_service()
    return HealthResponse(
        status="healthy",
        service="thesis-rag-service",
        rag_mode=service.mode,
        documents_indexed=service.documents_indexed,
        langsmith_enabled=bool(settings.langsmith_key),
    )


@app.post("/query", response_model=QueryResponse, tags=["rag"])
def query(request: QueryRequest) -> QueryResponse:
    try:
        question = request.resolved_query()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        return get_rag_service().query(question)
    except Exception as exc:
        logger.exception("RAG query failed")
        raise HTTPException(status_code=500, detail=f"RAG processing error: {exc}") from exc
