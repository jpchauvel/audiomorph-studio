from __future__ import annotations

import sys

import structlog


def setup_logging() -> None:
    processors: list[structlog.types.Processor] = [
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.JSONRenderer(),
    ]

    structlog.configure(
        processors=processors,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "audiomorph") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
