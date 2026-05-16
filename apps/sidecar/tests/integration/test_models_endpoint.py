from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


def test_list_models_returns_catalog(app_client, auth_headers) -> None:
    resp = app_client.get("/models", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert isinstance(body["items"], list)
    assert len(body["items"]) >= 1
    for item in body["items"]:
        assert "id" in item
        assert "name" in item
        assert "size_gb" in item


def test_list_models_requires_auth(app_client) -> None:
    resp = app_client.get("/models")
    assert resp.status_code == 401


def test_unknown_model_download_rejects(app_client, auth_headers) -> None:
    resp = app_client.post(
        "/models/totally/unknown-model-xyz/download", headers=auth_headers
    )
    assert resp.status_code in (400, 404, 422)
