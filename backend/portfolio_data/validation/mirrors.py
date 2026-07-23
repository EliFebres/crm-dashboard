"""
Proof that the TypeScript copies of this package's vocabulary still match it.

Two constants in `app/lib/db/portfolioTrends.ts` restate values owned here:

    DIMENSION_BUCKETS  <- BREAKDOWN_DIMENSIONS   (bucket order per dimension)
    SLEEVE_BENCHMARK   <- SLEEVE_BENCHMARK       (which index each sleeve uses)

They are hand-copied because the alternative — generating a TypeScript file from Python at
build time — buys correctness with a build step and a generated artifact in the tree, for
two small tables that change rarely.

The cost of hand-copying is that drift is **silent**, and silently wrong in the worst way:

  * A dimension added here and not there falls through the TypeScript's
    "unrecognized dimension" path, which sorts buckets alphabetically. A credit-quality
    axis then reads AA, AAA, B, BB, BBB, CCC & Below — plausible enough to be believed,
    and backwards. Nothing errors.
  * A bucket reordered on one side reorders one axis and no other, so two cards disagree
    about the same data.
  * A benchmark added here and not there leaves the sleeve unable to resolve its index, so
    the card silently loses its comparison.

None of that surfaces in a type check, a lint, or a page that renders. So the smoke test
asserts it instead. This module is the assertion; `test.py` is where it runs.

Parsing TypeScript with a regex is normally a poor idea. It is sound here because the
target is two flat object literals of string arrays with no nesting, no interpolation and
no computed keys — and because the failure mode is safe: an unparseable file yields "could
not read", which is reported, not silently passed.
"""

import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from ..core.models import Finding, Severity
from .vocabulary import BREAKDOWN_DIMENSIONS, SLEEVE_BENCHMARK

__all__ = ["MIRROR_SOURCE", "find_mirror_source", "check_mirrors"]

#: Path of the TypeScript file, relative to the repository root.
MIRROR_SOURCE = Path("app") / "lib" / "db" / "portfolioTrends.ts"


def find_mirror_source(start: Optional[Path] = None) -> Optional[Path]:
    """
    Locate the TypeScript mirror by walking up from this file.

    Returns None when it isn't there. That is a supported state, not a failure: the README
    documents copying `backend/` somewhere on its own, and such a copy has no app to
    compare against. Treating absence as a failure would break the smoke test for a
    deployment shape the package explicitly allows.
    """
    here = (start or Path(__file__)).resolve()
    for parent in here.parents:
        candidate = parent / MIRROR_SOURCE
        if candidate.is_file():
            return candidate
    return None


def _strip_comments(text: str) -> str:
    """Remove // and /* */ comments so they cannot be mistaken for entries."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def _extract_object(text: str, name: str) -> Optional[str]:
    """The body of `const <name> ... = { ... };`, or None if absent."""
    match = re.search(rf"const\s+{re.escape(name)}\b[^=]*=\s*\{{", text)
    if not match:
        return None
    depth = 0
    start = match.end() - 1
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return None


def _parse_string_arrays(body: str) -> Dict[str, List[str]]:
    """`key: ['a', 'b']` pairs. Order within each array is preserved — it is the point."""
    out: Dict[str, List[str]] = {}
    for key, values in re.findall(r"(\w+)\s*:\s*\[(.*?)\]", body, flags=re.DOTALL):
        out[key] = re.findall(r"'([^']*)'", values)
    return out


def _parse_strings(body: str) -> Dict[str, str]:
    """`key: 'value'` pairs."""
    return dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", body))


def _err(field: str, code: str, message: str) -> Finding:
    return Finding(field, code, Severity.ERROR, message)


def check_mirrors(source: Optional[Path] = None) -> Tuple[bool, List[Finding]]:
    """
    Compare the TypeScript mirrors against this package's vocabulary.

    Returns `(checked, findings)`. `checked` is False when the TypeScript file could not be
    found — the caller should report that as a skip. An empty findings list with
    `checked=True` means the two languages agree.
    """
    path = source or find_mirror_source()
    if path is None:
        return False, []

    try:
        text = _strip_comments(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return True, [_err("mirrors", "mirror_unreadable", f"Cannot read {path}: {exc}")]

    findings: List[Finding] = []

    # --- DIMENSION_BUCKETS ---------------------------------------------------------
    body = _extract_object(text, "DIMENSION_BUCKETS")
    if body is None:
        findings.append(_err(
            "DIMENSION_BUCKETS", "mirror_missing",
            f"No `const DIMENSION_BUCKETS = {{...}}` in {path.name}. If it was renamed, "
            f"update MIRROR_SOURCE and this check with it.",
        ))
    else:
        ts_dimensions = _parse_string_arrays(body)
        for dimension, buckets in BREAKDOWN_DIMENSIONS.items():
            ts_buckets = ts_dimensions.get(dimension)
            if ts_buckets is None:
                findings.append(_err(
                    f"DIMENSION_BUCKETS.{dimension}", "mirror_dimension_missing",
                    f"{dimension!r} is a breakdown dimension here but absent from "
                    f"{path.name}, so its buckets would be ordered alphabetically instead "
                    f"of {list(buckets)}.",
                ))
            elif ts_buckets != list(buckets):
                findings.append(_err(
                    f"DIMENSION_BUCKETS.{dimension}", "mirror_buckets_differ",
                    f"{dimension!r} buckets differ. Python: {list(buckets)}. "
                    f"{path.name}: {ts_buckets}. Order is the axis order, so this is a "
                    f"wrong chart, not a cosmetic difference.",
                ))
        for dimension in sorted(set(ts_dimensions) - set(BREAKDOWN_DIMENSIONS)):
            findings.append(_err(
                f"DIMENSION_BUCKETS.{dimension}", "mirror_dimension_extra",
                f"{path.name} declares {dimension!r}, which is not a breakdown dimension "
                f"here. Nothing can ever write it, so the card would stay empty.",
            ))

    # --- SLEEVE_BENCHMARK ----------------------------------------------------------
    body = _extract_object(text, "SLEEVE_BENCHMARK")
    if body is None:
        findings.append(_err(
            "SLEEVE_BENCHMARK", "mirror_missing",
            f"No `const SLEEVE_BENCHMARK = {{...}}` in {path.name}.",
        ))
    else:
        ts_benchmarks = _parse_strings(body)
        for sleeve, benchmark in SLEEVE_BENCHMARK.items():
            actual = ts_benchmarks.get(sleeve)
            if actual is None:
                findings.append(_err(
                    f"SLEEVE_BENCHMARK.{sleeve}", "mirror_sleeve_missing",
                    f"{sleeve!r} has no benchmark in {path.name}; its cards would lose "
                    f"their comparison against {benchmark!r}.",
                ))
            elif actual != benchmark:
                findings.append(_err(
                    f"SLEEVE_BENCHMARK.{sleeve}", "mirror_benchmark_differs",
                    f"{sleeve!r} is measured against {benchmark!r} here and {actual!r} in "
                    f"{path.name}.",
                ))
        for sleeve in sorted(set(ts_benchmarks) - set(SLEEVE_BENCHMARK)):
            findings.append(_err(
                f"SLEEVE_BENCHMARK.{sleeve}", "mirror_sleeve_extra",
                f"{path.name} maps sleeve {sleeve!r}, which is not a sleeve here.",
            ))

    return True, findings
