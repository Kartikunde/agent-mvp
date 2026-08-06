"""Central configuration, loaded from environment variables / .env file."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    tavily_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash" 
    max_iterations: int = 8


settings = Settings()
