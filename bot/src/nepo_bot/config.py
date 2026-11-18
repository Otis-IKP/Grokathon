from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_WEBHOOK_SECRET = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-5-5"

    host: str = "0.0.0.0"
    port: int = 8787
    public_base_url: str = "http://localhost:8787"
    webhook_base_url: str = ""

    messaging_provider: str = "local"
    messaging_webhook_secret: str = DEFAULT_WEBHOOK_SECRET
    # Local development only: lets the placeholder webhook secret above be used.
    dev_mode: bool = False

    sendblue_api_key: str = ""
    sendblue_api_secret: str = ""
    sendblue_from_number: str = ""

    linq_api_token: str = ""
    linq_from_number: str = ""

    loopmessage_auth_key: str = ""
    loopmessage_secret_key: str = ""
    loopmessage_sender_name: str = ""

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    backend_base_url: str = "http://localhost:8000"
    backend_api_key: str = ""
    use_stub_backend: bool = True

    demo_user_phone: str = "+12035550100"
    demo_user_id: str = "user_maya"


@lru_cache
def get_settings() -> Settings:
    return Settings()
