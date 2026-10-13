"""Simulated Gemini errors: never call external services in CI."""
import json

import httpx
import pytest
from fastapi import HTTPException

from app import ai


def fake_response(status: int, payload: dict) -> httpx.Response:
    return httpx.Response(status, json=payload, request=httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/models/demo:generateContent"))


@pytest.mark.parametrize(
    ("code", "expected"),
    [(400, "400"), (401, "401"), (403, "403"), (404, "404"), (429, "429"), (503, "503")],
)
def test_errors_are_specific_but_do_not_leak_provider_payload(code, expected, caplog):
    response = fake_response(code, {"error": {"status": "INVALID_ARGUMENT", "message": "private prompt and key data must not be logged"}})
    with pytest.raises(HTTPException) as error:
        ai._raise_provider_error(response, "gemini")
    assert expected in error.value.detail
    assert "private prompt" not in caplog.text
    assert "private prompt" not in error.value.detail
    assert "gemini" in caplog.text


def test_gemini_retries_legacy_schema_when_provider_does_not_support_response_format(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key")
    monkeypatch.setenv("GEMINI_MODEL", "models/demo")
    submitted = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "fake-key"
        body = json.loads(request.content)
        submitted.append(body)
        if len(submitted) == 1:
            return httpx.Response(
                400,
                json={"error": {"status": "INVALID_ARGUMENT", "message": "Unknown name responseFormat at generationConfig"}},
            )
        return httpx.Response(200, json={
            "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({"title": "demo"})}]}}],
        })

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        output = ai._request_gemini(client, {"topic": "A short test"})
    assert json.loads(output)["title"] == "demo"
    assert "responseFormat" in submitted[0]["generationConfig"]
    assert "responseJsonSchema" in submitted[1]["generationConfig"]
    assert "responseMimeType" in submitted[1]["generationConfig"]


def test_bad_key_never_triggers_duplicate_requests(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key")
    monkeypatch.setenv("GEMINI_MODEL", "demo")
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED", "message": "access blocked"}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(HTTPException) as exc:
            ai._request_gemini(client, {"topic": "Test"})
    assert exc.value.status_code == 502
    assert "403" in exc.value.detail
    assert len(requests) == 1
