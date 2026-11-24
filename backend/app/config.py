from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data" / "thesis"
VECTORSTORE_DIR = BACKEND_ROOT / "data" / "vectorstore"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../frontend/.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str | None = None
    langchain_api_key: str | None = None
    langsmith_api_key: str | None = None
    langchain_tracing_v2: bool = True
    langchain_project: str = "thesis-rag-service"
    openai_chat_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    retrieval_k: int = 4
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def langsmith_key(self) -> str | None:
        return self.langchain_api_key or self.langsmith_api_key

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
