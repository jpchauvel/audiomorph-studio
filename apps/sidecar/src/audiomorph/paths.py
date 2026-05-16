from pathlib import Path
import os
import sys

APP_NAME = "AudioMorph Studio"
APP_NAME_SLUG = "audiomorph-studio"


def get_user_data_dir() -> Path:
    override = os.environ.get("AUDIOMORPH_DATA_DIR")
    if override:
        return Path(override)

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(appdata) / APP_NAME
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        return Path(xdg) / APP_NAME_SLUG


def get_models_dir() -> Path:
    return get_user_data_dir() / "models"


def get_logs_dir() -> Path:
    return get_user_data_dir() / "logs"


def get_cache_dir() -> Path:
    return get_user_data_dir() / "cache"


def get_default_models_dir() -> Path:
    return get_models_dir()


def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p
