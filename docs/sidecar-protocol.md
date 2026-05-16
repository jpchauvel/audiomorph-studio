# Sidecar Bootstrap & Runtime Protocol

This document defines how the desktop host process launches and communicates with the Python sidecar.

## Launch Contract

The sidecar entrypoint is `python -m audiomorph` and accepts:

- `--port=<int>`: requested TCP port, default `0` (OS-assigned ephemeral port)
- `--host=<str>`: bind host, default `127.0.0.1` (loopback only)
- `--parent-pid=<int>`: PID of desktop parent process (required)
- `--handshake-fd=<int>`: writable file descriptor for handshake payload (Unix/macOS)
- `--handshake-file=<path>`: handshake file path fallback (Windows)
- `--auth-token=<hex>`: shared secret bearer token, required for protected routes

`--handshake-fd` or `--handshake-file` must be provided. On Windows, use `--handshake-file`.

## Port Discovery Handshake

The sidecar binds and listens before Uvicorn starts accepting requests:

1. Pre-bind socket on `127.0.0.1` and requested port (`0` means dynamic assignment).
2. Compute `actual_port = sock.getsockname()[1]`.
3. Emit handshake JSON over the configured channel.
4. Start Uvicorn with the pre-bound socket fd.

Handshake payload schema:

```json
{"port": 42837, "token": "<hex>", "pid": 12345}
```

- `port`: resolved listening port
- `token`: exact shared secret expected in request header
- `pid`: sidecar process id

The handshake is emitted *before* server startup, so the host can reliably discover endpoint details without parsing logs.

## Authentication

Protected routes require header:

- `X-Audiomorph-Token: <hex>`

Token comparison uses constant-time `hmac.compare_digest`. Token values must never be logged.

Exempt paths:

- `/healthz`

Unauthorized response payload:

```json
{"code":"KEY_VAULT_ERROR","message":"Unauthorized","retriable":false}
```

HTTP status: `401`.

## Lifecycle & Watchdog

On startup, a parent watchdog daemon thread begins polling every second.

- Unix/macOS: parent alive iff `os.getppid() == <parent-pid>`.
- Windows: parent alive iff `psutil.pid_exists(<parent-pid>)`.

When parent death is detected:

1. Set `server.should_exit = True` to request graceful Uvicorn shutdown.
2. Wait up to ~2 seconds.
3. Exit process.

This prevents zombie sidecar processes after desktop crashes or forced exits.

## Signals / Termination

- Normal host-controlled shutdown may terminate sidecar process directly.
- Watchdog-triggered parent-death shutdown is self-initiated.
- Sidecar should exit within 5 seconds in integration lifecycle tests.
