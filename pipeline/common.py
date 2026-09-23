"""Shared paths, config loading, and the fetch log."""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
CONFIG = ROOT / "config"
DATA = ROOT / "data"
SITE_DATA = ROOT / "site" / "public" / "data"
FETCH_LOG = RAW / "_fetchlog.json"

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


class DataError(RuntimeError):
    """A source could not be fetched or parsed. The build must stop, not guess."""


def load_json(path: Path):
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, obj, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"))
        else:
            json.dump(obj, f, indent=2)
            f.write("\n")


def counties() -> dict:
    return load_json(CONFIG / "counties.json")


def assumptions() -> dict:
    return load_json(CONFIG / "assumptions.json")


def county_geoids() -> list[str]:
    c = counties()
    return [c["state_fips"] + x["fips"] for x in c["counties"]]


def census_key() -> str | None:
    key = os.environ.get("CENSUS_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("CENSUS_API_KEY="):
                return line.split("=", 1)[1].strip() or None
    return None


def read_fetch_log() -> dict:
    return load_json(FETCH_LOG) if FETCH_LOG.exists() else {}


def log_fetch(source_id: str, url: str, path: Path) -> None:
    log = read_fetch_log()
    log[source_id] = {
        "url": url,
        "file": str(path.relative_to(ROOT)),
        "retrieved": dt.date.today().isoformat(),
    }
    write_json(FETCH_LOG, log)
