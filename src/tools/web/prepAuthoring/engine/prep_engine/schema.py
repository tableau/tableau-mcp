from functools import lru_cache
from pathlib import Path
import yaml


@lru_cache(maxsize=1)
def load_schema():
    return yaml.safe_load(Path(__file__).with_name("tableau_prep_flow.schema.yaml").read_text(encoding="utf-8"))
