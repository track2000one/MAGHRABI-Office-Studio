"""Disposable PostgreSQL integration checks for account and project isolation."""
import os
import uuid

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import cloud_projects

HEADER = {"X-Maghrabi-Client": "studio"}
SETUP = "this-is-a-test-setup-secret-not-for-production"


@pytest.fixture()
def clients(monkeypatch):
    if not os.getenv("CI") or not os.getenv("DATABASE_URL"):
        pytest.skip("Cloud integration tests require an ephemeral CI database")
    monkeypatch.setenv("STUDIO_ACCESS_TOKEN", SETUP)
    app = FastAPI()
    app.include_router(cloud_projects.router)
    with TestClient(app) as admin, TestClient(app) as other:
        admin.get("/api/v1/account/status")
        with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
            connection.execute("TRUNCATE studio_cloud_projects, studio_invites, studio_sessions, studio_accounts CASCADE")
            connection.commit()
        yield admin, other


def owner(admin):
    response = admin.post("/api/v1/account/bootstrap", headers=HEADER, json={
        "email": "owner@example.test", "password": "strong-first-test-password",
        "setup_token": SETUP,
    })
    assert response.status_code == 200, response.text


def user(admin, other):
    token = admin.post("/api/v1/account/invite", headers=HEADER).json()["invitation"]
    response = other.post("/api/v1/account/register", headers=HEADER, json={
        "email": "member@example.test", "password": "strong-second-test-password",
        "invitation": token,
    })
    assert response.status_code == 200, response.text
    return token


def project(project_id=None, version=0):
    return {
        "id": project_id or str(uuid.uuid4()),
        "date": "2026-10-14T01:00:00Z",
        "content": {
            "title": "تقرير تجريبي",
            "summary": "هذه بيانات اختبار وليست بيانات حقيقية.",
            "language": "ar",
            "sections": [
                {"title": "المقدمة", "body": ["محتوى مختصر."], "notes": ""},
                {"title": "التوصيات", "body": ["ملاحظات تجريبية."], "notes": ""},
            ],
        },
        "format": "docx", "stage": "edit", "context": {}, "version": version,
    }


def save(client, item):
    return client.put("/api/v1/projects/" + item["id"], headers=HEADER, json=item)


def test_owner_and_member_can_only_view_their_own_projects(clients):
    admin, other = clients
    owner(admin)
    user(admin, other)
    first = project()
    assert save(admin, first).status_code == 200
    assert other.get("/api/v1/projects").json()["projects"] == []
    assert other.delete("/api/v1/projects/" + first["id"], headers=HEADER).status_code == 404
    assert save(other, {**first, "version": 1}).status_code == 409
    second = project()
    assert save(other, second).status_code == 200
    assert [p["id"] for p in admin.get("/api/v1/projects").json()["projects"]] == [first["id"]]
    assert [p["id"] for p in other.get("/api/v1/projects").json()["projects"]] == [second["id"]]


def test_stale_versions_are_rejected_without_overwriting(clients):
    admin, _ = clients
    owner(admin)
    original = project()
    assert save(admin, original).json()["version"] == 1
    next_data = {**original, "version": 1}
    next_data["content"] = {**original["content"], "title": "عنوان أحدث"}
    assert save(admin, next_data).json()["version"] == 2
    assert save(admin, {**original, "version": 1}).status_code == 409
    assert admin.get("/api/v1/projects").json()["projects"][0]["content"]["title"] == "عنوان أحدث"


def test_invitation_is_one_use_and_owner_only(clients):
    admin, other = clients
    owner(admin)
    invitation = user(admin, other)
    assert other.post("/api/v1/account/invite", headers=HEADER).status_code == 403
    assert admin.post("/api/v1/account/register", headers=HEADER, json={
        "email": "another@example.test", "password": "another-sufficient-test-password",
        "invitation": invitation,
    }).status_code == 403


def test_sessions_revoke_and_bootstrap_cannot_repeat(clients):
    admin, _ = clients
    owner(admin)
    assert admin.post("/api/v1/account/bootstrap", headers=HEADER, json={
        "email": "another@example.test", "password": "another-sufficient-test-password",
        "setup_token": SETUP,
    }).status_code == 409
    assert admin.post("/api/v1/account/logout", headers=HEADER).status_code == 200
    assert admin.get("/api/v1/projects").status_code == 401
    assert admin.post("/api/v1/account/login", headers=HEADER, json={
        "email": "owner@example.test", "password": "strong-first-test-password",
    }).status_code == 200


def test_cross_origin_submission_rejected(clients):
    admin, _ = clients
    owner(admin)
    candidate = project()
    response = admin.put("/api/v1/projects/" + candidate["id"], json=candidate,
                         headers={**HEADER, "Origin": "https://foreign.example.test"})
    assert response.status_code == 403
    assert admin.get("/api/v1/projects").json()["projects"] == []
