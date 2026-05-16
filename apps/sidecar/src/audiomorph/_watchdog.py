from __future__ import annotations

import os
import sys
import threading
import time
from typing import Protocol

import psutil


class SupportsShouldExit(Protocol):
    should_exit: bool


def start_watchdog(parent_pid: int, server: SupportsShouldExit) -> threading.Thread:
    def _monitor() -> None:
        while True:
            time.sleep(1.0)

            if os.name == "nt":
                parent_alive = psutil.pid_exists(parent_pid)
            else:
                parent_alive = os.getppid() == parent_pid

            if parent_alive:
                continue

            server.should_exit = True
            time.sleep(2.0)
            sys.exit(0)

    thread = threading.Thread(target=_monitor, name="parent-watchdog", daemon=True)
    thread.start()
    return thread
