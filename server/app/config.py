import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./intent.db")
    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "true").lower() == "true"
    session_seconds: int = 7 * 24 * 3600
    ai_timeout: float = 120
    ai_queue_timeout: float = 15
    ai_queue_size: int = 4


settings = Settings()
