"""Short-lived signed AI access sessions; provider keys remain server-side."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

COOKIE_NAME = "maghrabi_ai_session"
SESSION_MAX_AGE = 7 * 24 * 60 * 60
_SESSION_CONTEXT = b"maghrabi-office-studio/ai-session/v1"


def _signing_key() -> bytes | None:
    secret = os.getenv("STUDIO_ACCESS_TOKEN")
    if not secret:
        return None
    return hmac.new(secret.encode("utf-8"), _SESSION_CONTEXT, hashlib.sha256).digest()


def _sign(message: str, key: bytes) -> str:
    signature = hmac.new(key, message.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")


def create_session() -> str:
    key = _signing_key()
    if key is None:
        raise RuntimeError("AI access is not configured")
    payload = f"v1.{int(time.time()) + SESSION_MAX_AGE}.{secrets.token_urlsafe(24)}"
    return f"{payload}.{_sign(payload, key)}"


def session_is_valid(value: str | None) -> bool:
    if not value or len(value) > 256:
        return False
    key = _signing_key()
    if key is None:
        return False
    parts = value.split(".")
    if len(parts) != 4 or parts[0] != "v1" or not parts[1].isdigit():
        return False
    expiry = int(parts[1])
    now = time.time()
    if expiry <= now or expiry > now + SESSION_MAX_AGE:
        return False
    payload = ".".join(parts[:3])
    return hmac.compare_digest(parts[3], _sign(payload, key))
