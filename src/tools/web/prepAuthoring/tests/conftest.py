"""Optional Python test setup; dependencies are reused, never installed here."""

from pathlib import Path
import importlib
import os
import sys

import pytest

sys.dont_write_bytecode = True
if os.environ.get("PREP_AUTHORING_TEST_DEPENDENCIES"):
    sys.path.insert(0, os.environ["PREP_AUTHORING_TEST_DEPENDENCIES"])
ENGINE = Path(__file__).resolve().parents[1] / "engine"
sys.path.insert(0, str(ENGINE))
authoring = importlib.import_module("prep_engine.authoring")

ORIGINAL_READER = authoring._read_limited


@pytest.fixture(autouse=True)
def restore_engine_reader():
    yield
    authoring._read_limited = ORIGINAL_READER
