import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph.paths import (
    get_cache_dir,
    get_default_models_dir,
    get_logs_dir,
    get_models_dir,
    get_user_data_dir,
)


def test_get_user_data_dir_contains_app_name_on_darwin():
    if sys.platform == "darwin":
        user_dir = get_user_data_dir()
        assert "Application Support" in str(user_dir)
        assert "AudioMorph Studio" in str(user_dir)


def test_get_models_dir_is_child_of_user_data_dir():
    user_dir = get_user_data_dir()
    models_dir = get_models_dir()
    assert str(models_dir).startswith(str(user_dir))
    assert "models" in str(models_dir)


def test_get_logs_dir_is_child_of_user_data_dir():
    user_dir = get_user_data_dir()
    logs_dir = get_logs_dir()
    assert str(logs_dir).startswith(str(user_dir))
    assert "logs" in str(logs_dir)


def test_get_cache_dir_is_child_of_user_data_dir():
    user_dir = get_user_data_dir()
    cache_dir = get_cache_dir()
    assert str(cache_dir).startswith(str(user_dir))
    assert "cache" in str(cache_dir)


def test_get_default_models_dir_equals_get_models_dir():
    assert get_default_models_dir() == get_models_dir()


def test_audiomorph_data_dir_env_override():
    override = "/tmp/test-audiomorph"
    os.environ["AUDIOMORPH_DATA_DIR"] = override
    try:
        assert str(get_user_data_dir()) == override
    finally:
        del os.environ["AUDIOMORPH_DATA_DIR"]
