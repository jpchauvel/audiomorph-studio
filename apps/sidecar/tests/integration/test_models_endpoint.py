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


# Regression: FastAPI {model_id} path param does not match '/'.
# Renderer must encode '/' as '__'; manager.normalize_and_validate_model_id decodes.
_HEARTMULA_PAIRS = [
    ("HeartMuLa__HeartMuLaGen", "HeartMuLa/HeartMuLaGen"),
    (
        "HeartMuLa__HeartMuLa-oss-3B-happy-new-year",
        "HeartMuLa/HeartMuLa-oss-3B-happy-new-year",
    ),
    (
        "HeartMuLa__HeartCodec-oss-20260123",
        "HeartMuLa/HeartCodec-oss-20260123",
    ),
    ("HeartMuLa__HeartTranscriptor-oss", "HeartMuLa/HeartTranscriptor-oss"),
]


@pytest.mark.parametrize(("encoded", "decoded"), _HEARTMULA_PAIRS)
def test_encoded_model_id_verify_route_resolves(
    app_client, auth_headers, encoded, decoded
) -> None:
    _ = decoded
    app_client.delete(f"/models/{encoded}", headers=auth_headers)
    resp = app_client.post(f"/models/{encoded}/verify", headers=auth_headers)
    assert resp.status_code != 404, resp.text
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "valid" in body
    assert "mismatches" in body


@pytest.mark.parametrize(("encoded", "decoded"), _HEARTMULA_PAIRS)
def test_encoded_model_id_delete_route_resolves(
    app_client, auth_headers, encoded, decoded
) -> None:
    _ = decoded
    resp = app_client.delete(f"/models/{encoded}", headers=auth_headers)
    assert resp.status_code != 404, resp.text
    assert resp.status_code == 204, resp.text


def test_raw_slash_model_id_paths_return_404(
    app_client, auth_headers
) -> None:
    # Negative control: raw '/' in {model_id} produces 404 because
    # FastAPI path params do not match '/'. Renderer MUST encode as '__'.
    resp = app_client.post(
        "/models/HeartMuLa/HeartMuLaGen/verify", headers=auth_headers
    )
    assert resp.status_code == 404

    resp = app_client.delete(
        "/models/HeartMuLa/HeartMuLaGen", headers=auth_headers
    )
    assert resp.status_code == 404
