from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration

TEST_TOKEN = "test-token-deterministic-do-not-use-in-prod"


def test_healthz_requires_no_auth(app_client) -> None:
    resp = app_client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_protected_route_rejects_missing_token(app_client) -> None:
    resp = app_client.get("/settings")
    assert resp.status_code == 401


def test_protected_route_rejects_wrong_token(app_client) -> None:
    resp = app_client.get("/settings", headers={"X-Audiomorph-Token": "wrong"})
    assert resp.status_code == 401


def test_protected_route_accepts_correct_token(app_client, auth_headers) -> None:
    resp = app_client.get("/settings", headers=auth_headers)
    assert resp.status_code == 200


def test_authorization_bearer_header_is_not_accepted(app_client) -> None:
    resp = app_client.get(
        "/settings",
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )
    assert resp.status_code == 401
