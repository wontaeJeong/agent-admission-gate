from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AAG_", env_file=".env", extra="ignore")
    environment: Literal["development", "stg", "prod", "test"] = "development"
    database_url: str = "sqlite:///./data/aag.db"
    public_url: str = "http://localhost:8000"
    auth_mode: Literal["local", "oidc"] = "local"
    bootstrap_admin: str = "admin"
    bootstrap_password: SecretStr = SecretStr("")
    oidc_issuer: str = ""
    oidc_admin_subjects: list[str] = []
    oidc_client_id: str = "agent-admission-gate"
    oidc_client_secret: SecretStr = SecretStr("")
    cookie_secure: bool = False
    allowed_git_hosts: list[str] = ["github.com"]
    boards_enabled: bool = False
    runner_concurrency: int = Field(default=2, ge=1, le=8)
    queue_capacity: int = Field(default=50, ge=1, le=1000)
    scan_timeout: int = Field(default=300, ge=5, le=3600)
    max_upload_bytes: int = 20 * 1024 * 1024
    max_extracted_bytes: int = 100 * 1024 * 1024
    max_files: int = 5000
    cache_seconds: int = 3600
    policy_version: str = "2026-10-30.1"
    # Increment when scanner binaries, vulnerability databases, or policy configuration change.
    scanner_revision: str = "local-v1"
    grype_db_cache_dir: str = ""
    grype_db_auto_update: bool = True
    osv_enabled: bool = False
    llm_provider: Literal["disabled", "onprem", "bedrock", "systemone"] = "disabled"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: SecretStr = SecretStr("")
    llm_model: str = ""
    llm_timeout: int = 60
    bedrock_region: str = "us-east-1"
    systemone_runtime: Literal["hosted", "ollama"] = "hosted"
    systemone_review_threshold: float = Field(default=0.35, ge=0, le=1)
    frontend_dir: Path = Path("frontend/dist")

    @model_validator(mode="after")
    def production_safety(self):
        if self.environment in {"stg", "prod"}:
            if not self.public_url.startswith("https://") or not self.cookie_secure:
                raise ValueError("stg/prod require HTTPS public_url and cookie_secure=true")
            if self.auth_mode != "oidc":
                raise ValueError("stg/prod require OIDC authentication")
        if self.auth_mode == "oidc" and not self.oidc_issuer.startswith("https://"):
            raise ValueError("OIDC issuer must use HTTPS")
        if self.llm_provider != "disabled" and not self.llm_model:
            raise ValueError("An explicit model is required for enabled LLM providers")
        return self


@lru_cache
def get_settings():
    return Settings()
