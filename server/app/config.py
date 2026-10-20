import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./intent.db")
    # With an API key the assistant uses an OpenAI-compatible cloud API (Groq by default),
    # otherwise the local Ollama model.
    ai_api_key: str = field(default_factory=lambda: os.getenv("AI_API_KEY") or os.getenv("GROQ_API_KEY", ""), repr=False)
    ai_base_url: str = os.getenv("AI_BASE_URL", "https://api.groq.com/openai/v1")
    ai_model: str = os.getenv("AI_MODEL", "openai/gpt-oss-120b")
    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "true").lower() == "true"
    # Keep users signed in on their personal devices unless they log out.
    session_seconds: int = 10 * 365 * 24 * 3600
    ai_timeout: float = 120
    ai_queue_timeout: float = 15
    ai_queue_size: int = 4


settings = Settings()
