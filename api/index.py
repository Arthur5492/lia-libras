"""Entry point for Vercel Functions. Stage 4 will validate the deploy configuration."""
from backend.libras_api.app import app

__all__ = ["app"]
