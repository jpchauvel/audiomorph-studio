from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket

import uvicorn

from audiomorph._watchdog import start_watchdog
from audiomorph.app import create_app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AudioMorph sidecar entrypoint"
    )
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--handshake-fd", type=int)
    parser.add_argument("--handshake-file", type=str)
    parser.add_argument("--auth-token", type=str, required=True)
    return parser.parse_args()


def write_handshake(
    *, fd: int | None, path: str | None, payload: dict[str, int | str]
) -> None:
    encoded = (json.dumps(payload) + "\n").encode("utf-8")

    if fd is not None:
        with os.fdopen(fd, "wb", closefd=True) as pipe:
            pipe.write(encoded)
            pipe.flush()
        return

    if path:
        Path(path).write_bytes(encoded)
        return

    raise ValueError(
        "Either --handshake-fd or --handshake-file must be provided"
    )


def main() -> int:
    args = parse_args()

    # AUDIOMORPH_TEST_MODE hook
    if (
        os.environ.get("CI") == "true"
        and os.environ.get("AUDIOMORPH_TEST_MODE") != "1"
    ):
        import sys

        sys.stderr.write("AUDIOMORPH_TEST_MODE required in CI\n")
        sys.stderr.flush()
        return 78

    if args.host != "127.0.0.1":
        raise ValueError("Only loopback host 127.0.0.1 is allowed")

    if os.name == "nt" and not args.handshake_file:
        raise ValueError("--handshake-file is required on Windows")

    if (
        os.name != "nt"
        and args.handshake_fd is None
        and not args.handshake_file
    ):
        raise ValueError("--handshake-fd or --handshake-file is required")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((args.host, args.port))
    sock.listen(socket.SOMAXCONN)
    actual_port = sock.getsockname()[1]

    app = create_app(auth_token=args.auth_token)
    config = uvicorn.Config(
        app=app, host=args.host, port=args.port, log_level="warning"
    )
    config.fd = sock.fileno()
    server = uvicorn.Server(config=config)

    start_watchdog(args.parent_pid, server)

    write_handshake(
        fd=args.handshake_fd,
        path=args.handshake_file,
        payload={
            "port": actual_port,
            "token": args.auth_token,
            "pid": os.getpid(),
        },
    )

    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
