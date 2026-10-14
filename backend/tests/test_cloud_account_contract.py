"""Account and project contract checks, using a disposable test database."""
import os
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.cloud_projects import router


@pytest.fixture
def client():
    if not os.getenv("DATABASE_URL"):
        pytest.skip("Disposable PostgreSQL required")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as result:
        yield result


def test_cloud_status_starts_without_an_account(client):
    response = client.get("/api/v1/account/status")
    assert response.status_code == 200
    assert response.json()["available"] is True


def test_project_listing_requires_an_authenticated_account(client):
    response = client.get("/api/v1/projects")
    assert response.status_code == 401


def test_mutations_require_the_studio_client_header(client):
    response = client.post("/api/v1/account/login", json={
        "email": "sample@example.org", "password": "long-example-password",
    })
    assert response.status_code == 403


def test_account_routes_are_mounted_in_the_production_application():
    from app.main import app
    mounted = {route.path for route in app.routes}
    assert "/api/v1/account/status" in mounted
    assert "/api/v1/projects" in mounted
