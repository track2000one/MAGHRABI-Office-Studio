from app import ai_session


def test_session_roundtrip_and_tamper(monkeypatch):
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN", "test-secret-long-random")
    monkeypatch.setattr(ai_session.time, "time", lambda: 1_700_000_000)
    token = ai_session.create_session()
    assert ai_session.session_is_valid(token)
    parts = token.split(".")
    parts[1] = str(int(parts[1]) - 1)
    assert not ai_session.session_is_valid(".".join(parts))
    assert not ai_session.session_is_valid("a" * 1000)
    assert not ai_session.session_is_valid("")


def test_session_expiration_and_secret_rotation(monkeypatch):
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN", "test-secret-1")
    monkeypatch.setattr(ai_session.time, "time", lambda: 1_700_000_000)
    token = ai_session.create_session()
    monkeypatch.setattr(ai_session.time, "time", lambda: 1_700_000_000 + ai_session.SESSION_MAX_AGE + 1)
    assert not ai_session.session_is_valid(token)
    monkeypatch.setattr(ai_session.time, "time", lambda: 1_700_000_000)
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN", "test-secret-2")
    assert not ai_session.session_is_valid(token)
    monkeypatch.delenv("STUDIO_ACCESS_TOKEN")
    assert not ai_session.session_is_valid(token)
