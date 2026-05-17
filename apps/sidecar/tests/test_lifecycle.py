from __future__ import annotations

import json
import os
import secrets
import select
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def _get_json(
    url: str, *, token: str | None = None
) -> tuple[int, dict[str, Any]]:
    headers: dict[str, str] = {}
    if token:
        headers["X-Audiomorph-Token"] = token

    req = Request(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=3) as response:
            return response.getcode(), json.loads(
                response.read().decode("utf-8")
            )
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_sidecar_lifecycle() -> None:
    token = secrets.token_hex(16)
    read_fd, write_fd = os.pipe()

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "audiomorph",
            "--port=0",
            "--host=127.0.0.1",
            f"--parent-pid={os.getpid()}",
            f"--handshake-fd={write_fd}",
            f"--auth-token={token}",
        ],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env={
            **os.environ,
            "PYTHONPATH": "src",
            "AUDIOMORPH_TEST_MODE": "1",
        },
        pass_fds=(write_fd,),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    os.close(write_fd)

    try:
        handshake_deadline = time.monotonic() + 15
        while True:
            remaining = handshake_deadline - time.monotonic()
            if remaining <= 0:
                if proc.poll() is not None and proc.stderr is not None:
                    raise AssertionError(
                        "Timed out waiting for handshake; sidecar exited: "
                        f"{proc.stderr.read().strip()}"
                    )
                raise AssertionError("Timed out waiting for handshake")

            ready, _, _ = select.select(
                [read_fd], [], [], min(0.25, remaining)
            )
            if ready:
                break

            if proc.poll() is not None:
                stderr_output = ""
                if proc.stderr is not None:
                    stderr_output = proc.stderr.read().strip()
                raise AssertionError(
                    "Sidecar exited before handshake"
                    + (f": {stderr_output}" if stderr_output else "")
                )

        handshake_raw = os.read(read_fd, 4096).decode("utf-8").strip()
        assert handshake_raw, "Missing handshake payload"
        handshake = json.loads(handshake_raw)

        port = int(handshake["port"])
        assert 1024 < port < 65536
        assert handshake["token"] == token
        assert handshake["pid"] == proc.pid

        url = f"http://127.0.0.1:{port}/healthz"

        for _ in range(30):
            if proc.poll() is not None:
                raise AssertionError("Sidecar exited before serving requests")

            status, body = _get_json(url, token=token)
            if status == 200:
                assert body["ok"] is True
                assert body["pid"] == proc.pid
                break
            time.sleep(0.1)
        else:
            raise AssertionError("Sidecar failed to serve /healthz")

        status, body = _get_json(f"http://127.0.0.1:{port}/missing")
        assert status == 401
        assert body == {
            "code": "KEY_VAULT_ERROR",
            "message": "Unauthorized",
            "retriable": False,
        }
    finally:
        os.close(read_fd)
        proc.terminate()
        proc.wait(timeout=5)
        assert proc.returncode is not None
