#!/usr/bin/env python3
"""
One-time script to precompute expected answers for the BIRD California Schools eval suite.

Reads the BIRD SQLite snapshot and VDS case file, executes gold SQL queries, and
writes evals/suites/bird-california-schools.json with all expected answers baked in.
The output file is committed to the repo so eval runners never need SQLite access.

Requires:
  bird_mini/data/dev_databases/california_schools/california_schools.sqlite
  bird_mini/data/test_cases/mini_dev_sqlite.json
  bird_mini/data/test_cases/mini_dev_postgresql_vds.json

Usage:
  python3 evals/scripts/precompute-bird-answers.py
"""

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
SQLITE_PATH = (
    REPO_ROOT
    / "bird_mini"
    / "data"
    / "dev_databases"
    / "california_schools"
    / "california_schools.sqlite"
)
SQLITE_CASES_PATH = REPO_ROOT / "bird_mini" / "data" / "test_cases" / "mini_dev_sqlite.json"
VDS_CASES_PATH = (
    REPO_ROOT / "bird_mini" / "data" / "test_cases" / "mini_dev_postgresql_vds.json"
)
OUTPUT_PATH = REPO_ROOT / "evals" / "suites" / "bird-california-schools.json"

DEFAULT_BUDGET = {"max_wall_ms": 180000}


DATASOURCE_LUID_PLACEHOLDER = "{{env.EVAL_DATASOURCE_LUID}}"


def build_prompt(question: str, evidence: str) -> str:
    if not evidence:
        return f"Using datasource {DATASOURCE_LUID_PLACEHOLDER}: {question}"
    separator = " " if question.rstrip().endswith(("?", "!", ".")) else ". "
    return f"Using datasource {DATASOURCE_LUID_PLACEHOLDER}: {question}{separator}{evidence}"


def run_sql(conn: sqlite3.Connection, sql: str):
    """Execute SQL and return (rows, column_names, error)."""
    try:
        cursor = conn.execute(sql)
        rows = cursor.fetchall()
        columns = [d[0] for d in cursor.description] if cursor.description else []
        return rows, columns, None
    except Exception as exc:
        return None, None, str(exc)


def classify_result(rows, columns):
    """
    Determine answer_type, expected_value, and expected_row_count.

    Scalar: result is exactly 1 row × 1 column — the cell value is the answer.
    List:   everything else — row count is the meaningful fact.
    """
    if not rows and not columns:
        return "list", None, 0

    if len(rows) == 1 and len(columns) == 1:
        raw = rows[0][0]
        if isinstance(raw, float):
            value = raw
        elif isinstance(raw, int):
            value = raw
        else:
            # String scalar (e.g. a year returned as text)
            try:
                value = int(raw)
            except (TypeError, ValueError):
                try:
                    value = float(raw)
                except (TypeError, ValueError):
                    value = raw
        return "scalar", value, 1

    return "list", None, len(rows)


def extract_vds_columns(vds_query: dict) -> list[str]:
    """Field captions from VDS_QUERY.fields (the SELECT clause)."""
    captions = []
    for field in vds_query.get("fields", []):
        caption = field.get("fieldCaption")
        if caption:
            captions.append(caption)
    return captions


def extract_vds_filter_fields(vds_query: dict) -> list[str]:
    """Field captions from VDS_QUERY.filters (the WHERE clause)."""
    captions = []
    for f in vds_query.get("filters", []):
        caption = f.get("field", {}).get("fieldCaption")
        if caption:
            captions.append(caption)
    return captions


def main():
    for path in [SQLITE_PATH, SQLITE_CASES_PATH, VDS_CASES_PATH]:
        if not path.exists():
            print(f"ERROR: required file not found: {path}", file=sys.stderr)
            sys.exit(1)

    print(f"Loading SQLite cases from {SQLITE_CASES_PATH.relative_to(REPO_ROOT)}")
    with open(SQLITE_CASES_PATH) as f:
        sqlite_cases = {
            c["question_id"]: c
            for c in json.load(f)
            if c["db_id"] == "california_schools"
        }

    print(f"Loading VDS cases from {VDS_CASES_PATH.relative_to(REPO_ROOT)}")
    with open(VDS_CASES_PATH) as f:
        vds_cases = {
            c["question_id"]: c
            for c in json.load(f)
            if c["db_id"] == "california_schools"
        }

    print(f"Connecting to {SQLITE_PATH.relative_to(REPO_ROOT)}")
    conn = sqlite3.connect(str(SQLITE_PATH))

    suite = []
    errors = []

    for qid, sqlite_case in sorted(sqlite_cases.items()):
        vds_case = vds_cases.get(qid, {})
        question = sqlite_case["question"]
        evidence = sqlite_case.get("evidence", "")
        difficulty = sqlite_case.get("difficulty", "simple")
        sql = sqlite_case["SQL"]
        ai_summary = vds_case.get("ai_summarized_answer", "")
        vds_query = vds_case.get("VDS_QUERY", {})

        rows, columns, error = run_sql(conn, sql)

        if error:
            print(f"  Q{qid} ({difficulty}): SQL ERROR — {error}")
            errors.append({"question_id": qid, "error": error})
            answer_type, expected_value, expected_row_count = "list", None, None
        else:
            answer_type, expected_value, expected_row_count = classify_result(rows, columns)
            print(
                f"  Q{qid} ({difficulty}): {answer_type}, "
                f"value={expected_value}, rows={expected_row_count}"
            )

        expected_columns = extract_vds_columns(vds_query)
        expected_filter_fields = extract_vds_filter_fields(vds_query)

        suite.append(
            {
                "question_id": qid,
                "question": question,
                "evidence": evidence,
                "difficulty": difficulty,
                "answer_type": answer_type,
                "expected_value": expected_value,
                "expected_row_count": expected_row_count,
                "ai_summarized_answer": ai_summary,
                "expected_columns": expected_columns,
                "expected_filter_fields": expected_filter_fields,
            "prompt": build_prompt(question, evidence),
            "expected_tools": ["query-datasource"],
            "budget": DEFAULT_BUDGET,
            }
        )

    conn.close()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(suite, f, indent=2)
        f.write("\n")

    print(f"\nWrote {len(suite)} cases to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    if errors:
        print(f"WARNING: {len(errors)} cases had SQL errors: {[e['question_id'] for e in errors]}")


if __name__ == "__main__":
    main()
