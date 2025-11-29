"""
Helper utilities used by the Flask chatbot application.

The real project will eventually replace these helpers with richer
implementations, but the functions below provide a lightweight,
dependency-free baseline so the app can run locally without failing.
"""

from __future__ import annotations

import json
import pickle
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, List

try:
    import joblib  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    joblib = None


ROOT_DIR = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

_current_report_path: Path | None = None

# A compact list of common symptoms we can match without heavy NLP deps.
COMMON_SYMPTOMS = {
    "fever",
    "cough",
    "headache",
    "fatigue",
    "sore throat",
    "nausea",
    "vomiting",
    "diarrhea",
    "chills",
    "shortness of breath",
    "chest pain",
    "dizziness",
    "runny nose",
    "muscle pain",
    "joint pain",
    "rash",
}


def _sanitize_filename(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", name.strip())
    return safe or "patient"


def _ensure_report_file(name: str, age: str, gender: str) -> Path:
    """Create the base report file and remember its path."""
    global _current_report_path
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{_sanitize_filename(name)}_{timestamp}.pdf"
    _current_report_path = REPORTS_DIR / filename
    header = {
        "patient": {"name": name, "age": age, "gender": gender},
        "created_at": datetime.utcnow().isoformat(),
        "entries": [],
    }
    _current_report_path.write_text(json.dumps(header, indent=2), encoding="utf-8")
    return _current_report_path


def create_user_pdf(name: str, age: str, gender: str) -> Path:
    """
    Initialize a patient report file (JSON content with .pdf extension).

    Using JSON keeps things simple until a proper PDF pipeline is added.
    """
    return _ensure_report_file(name, age, gender)


def append_output_to_pdf(ml_output: Any) -> Path:
    """
    Append the latest model output to the stored report file.

    The data is appended as another JSON entry to avoid mutating binaries.
    """
    global _current_report_path
    if _current_report_path is None or not _current_report_path.exists():
        _current_report_path = _ensure_report_file("anonymous", "N/A", "N/A")

    report_data = json.loads(_current_report_path.read_text(encoding="utf-8"))
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "model_output": _stringify_output(ml_output),
    }
    report_data.setdefault("entries", []).append(entry)
    _current_report_path.write_text(json.dumps(report_data, indent=2), encoding="utf-8")
    return _current_report_path


def _stringify_output(value: Any) -> Any:
    if isinstance(value, (str, int, float)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_stringify_output(v) for v in value]
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:  # pragma: no cover - defensive
            pass
    return str(value)


def parse_symptoms_from_text(user_text: str) -> List[str]:
    """
    Extract a best-effort list of symptoms from free-form text.

    This intentionally avoids heavy NLP models so the backend stays
    lightweight. When more advanced extraction is ready we can swap
    this implementation behind the same interface.
    """
    text = f" {user_text.lower()} "
    found = {symptom for symptom in COMMON_SYMPTOMS if symptom in text}
    if found:
        return sorted(found)

    # Fallback: split by commas/periods and return non-empty chunks.
    chunks = [chunk.strip() for chunk in re.split(r"[,.]", user_text) if chunk.strip()]
    return chunks[:3]


def load_ml_dl_artifact(artifact_path: str | Path) -> Any:
    """
    Load a serialized model using joblib when available, otherwise pickle.
    """
    path = Path(artifact_path)
    if not path.exists():
        raise FileNotFoundError(f"Artifact not found: {path}")

    if joblib is not None:
        try:
            return joblib.load(path)
        except Exception:
            pass  # Fallback to pickle below.

    with path.open("rb") as f:
        return pickle.load(f)



