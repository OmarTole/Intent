"""Same-origin API and built PWA for a single cloud web service."""
from pathlib import Path
import os

from fastapi.staticfiles import StaticFiles

from .main import app

# API routes are registered first. Only the public build is exposed.
static_dir = Path(os.environ.get("INTENT_STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))
app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")
