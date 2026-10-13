"""Cookie login/logout and AI endpoint access checks without external AI calls."""
from fastapi.testclient import TestClient

from app import ai
from app.content import Content
from app.main import app


def test_ai_session_routes_and_authorization(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setenv("GEMINI_API_KEY", "fake-test-provider-key")
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN", "long-unguessable-test-secret")
    monkeypatch.setattr(
        ai,
        "generate",
        lambda _request: Content(
            title="Sample document",
            summary="Draft",
            language="ar",
            sections=[
                {"title": "One", "body": ["First text"], "notes": ""},
                {"title": "Two", "body": ["Second text"], "notes": ""},
            ],
        ),
    )
    payload = {"topic": "Sample AI topic", "section_count": 2}
    with TestClient(app) as client:
        status = client.get("/api/v1/ai/status").json()
        assert status["configured"] is True
        assert status["authenticated"] is False
        assert client.post("/api/v1/ai/generate", json=payload).status_code == 401
        assert client.post("/api/v1/ai/login", json={"access_token": "wrong"}).status_code == 401

        login = client.post(
            "/api/v1/ai/login",
            json={"access_token": "long-unguessable-test-secret"},
        )
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        assert "samesite=strict" in login.headers["set-cookie"].lower()
        assert client.get("/api/v1/ai/status").json()["authenticated"] is True

        # The browser's custom header is required for cookie-authorized AI calls.
        assert client.post("/api/v1/ai/test").status_code == 401
        test_result = client.post("/api/v1/ai/test", headers={"X-Maghrabi-Client": "studio"})
        assert test_result.status_code == 200
        assert test_result.json() == {"ok": True, "provider": "gemini"}
        assert client.post("/api/v1/ai/generate", json=payload).status_code == 401
        created = client.post(
            "/api/v1/ai/generate",
            json=payload,
            headers={"X-Maghrabi-Client": "studio"},
        )
        assert created.status_code == 200
        assert created.json()["title"] == "Sample document"

        assert client.post("/api/v1/ai/logout").status_code == 403
        assert client.post(
            "/api/v1/ai/logout",
            headers={"X-Maghrabi-Client": "studio"},
        ).status_code == 200
        assert client.get("/api/v1/ai/status").json()["authenticated"] is False
        assert client.post(
            "/api/v1/ai/generate",
            json=payload,
            headers={"X-Maghrabi-Client": "studio"},
        ).status_code == 401
