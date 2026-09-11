#!/usr/bin/env bash
#
# run-and-grade.sh — run an eval case N times and grade each run.
#
# Consolidates: eval:run  ->  capture the fresh run dir it prints  ->  eval:grade.
# Loops N times and prints a pass-rate summary (the W-23757364 case is LLM-mediated
# and wants an N>=5 pass-rate, not a single pass).
#
# PREREQ (one-time, NOT scriptable — it's an interactive Claude Code command):
#   /plugin marketplace add langchain-ai/langsmith-claude-code-plugins
#   /plugin install        # langsmith-tracing
# Grading is sourced entirely from the LangSmith trace; without the plugin every
# run grades GRADING_ERROR ("No LangSmith trace found"). Also needs `npm install`
# (langsmith dep) and a populated .env (SERVER/SITE_NAME/PAT_*/ADMIN_TOOLS_ENABLED/
# INSIGHTS_TOOLS_ENABLED/LANGSMITH_API_KEY/LANGSMITH_PROJECT).
#
# Usage:
#   evals/run-and-grade.sh [CASE_FILE] [N]
# Defaults:
#   CASE_FILE = evals/cases/admin/jtbd/admin-proactive-surfacing-broad-health.json
#   N         = 5

set -euo pipefail

CASE_FILE="${1:-evals/cases/admin/jtbd/admin-proactive-surfacing-broad-health.json}"
N="${2:-5}"

# Run from the repo root (dir above this script) so npm + relative paths resolve.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f "$CASE_FILE" ]]; then
  echo "ERROR: case file not found: $CASE_FILE" >&2
  exit 1
fi

echo "Case: $CASE_FILE"
echo "Runs: $N"
echo "Repo: $REPO_ROOT"
echo

pass=0; fail=0; tool_error=0; grading_error=0; other=0

for i in $(seq 1 "$N"); do
  echo "================ run $i/$N ================"

  # Run the case; capture stdout so we can extract the fresh run dir it prints
  # (line looks like: "Run dir: /abs/path/evals/runs/YYYY-MM-DD/<run-id>").
  run_out="$(npm run --silent eval:run -- "$CASE_FILE")"
  echo "$run_out"

  run_dir="$(printf '%s\n' "$run_out" | grep -oE 'evals/runs/[0-9]{4}-[0-9]{2}-[0-9]{2}/[^[:space:]]+' | head -n1)"
  if [[ -z "$run_dir" ]]; then
    # Fall back to the absolute "Run dir:" line if the relative form wasn't found.
    run_dir="$(printf '%s\n' "$run_out" | awk -F'Run dir:[[:space:]]*' '/Run dir:/{print $2}' | tail -n1 | xargs || true)"
  fi
  if [[ -z "$run_dir" ]]; then
    echo "ERROR: could not parse a run dir from eval:run output" >&2
    other=$((other+1)); continue
  fi

  echo "--- grading $run_dir ---"
  grade_out="$(npm run --silent eval:grade -- "$run_dir" || true)"
  echo "$grade_out"

  # Prefer the machine-readable result.json outcome; fall back to stdout.
  outcome=""
  if [[ -f "$run_dir/result.json" ]]; then
    outcome="$(grep -oE '"outcome"[[:space:]]*:[[:space:]]*"[^"]+"' "$run_dir/result.json" | head -n1 | sed -E 's/.*"([^"]+)"$/\1/')"
  fi
  [[ -z "$outcome" ]] && outcome="$(printf '%s\n' "$grade_out" | awk -F'Outcome:[[:space:]]*' '/Outcome:/{print tolower($2)}' | tail -n1 | xargs || true)"

  # Map the machine outcome to a loud, human verdict.
  case "$outcome" in
    pass)          pass=$((pass+1));                   verdict="✅ PASS" ;;
    tool_error)    tool_error=$((tool_error+1));       verdict="❌ FAIL (tool_error — expected tool errored, not counted as coverage)" ;;
    grading_error) grading_error=$((grading_error+1)); verdict="⚠️  NOT GRADED (grading_error — no LangSmith trace; install the tracing plugin)" ;;
    fail|"")       fail=$((fail+1));                   verdict="❌ FAIL" ;;
    *)             other=$((other+1));                 verdict="❓ ${outcome:-unknown}" ;;
  esac
  echo ">>> run $i verdict: $verdict"
  echo
done

echo "================ summary ================"
echo "case:          $CASE_FILE"
echo "runs:          $N"
echo "PASS:          $pass"
echo "fail:          $fail"
echo "tool_error:    $tool_error"
echo "grading_error: $grading_error"
echo "other:         $other"
if (( N > 0 )); then
  echo "pass-rate:     $pass/$N"
fi

# Overall verdict: SUCCESS only if every run graded PASS; otherwise report why.
echo
graded=$((pass+fail+tool_error+other))   # runs that actually produced a grade (trace found)
if (( grading_error == N )); then
  overall="⚠️  NOT GRADED — 0/$N runs produced a LangSmith trace (tracing plugin not installed)"
  rc=2
elif (( pass == N )); then
  overall="✅ SUCCESS — $pass/$N PASS"
  rc=0
elif (( graded > 0 && pass == graded && grading_error > 0 )); then
  overall="⚠️  PARTIAL — $pass/$graded graded runs PASS, but $grading_error/$N had no trace (install the tracing plugin)"
  rc=2
else
  overall="❌ FAILURE — $pass/$N PASS"
  rc=1
fi
echo "OVERALL: $overall"

if (( grading_error > 0 )); then
  echo
  echo "NOTE: grading_error = LangSmith tracing plugin not installed (no trace posted)."
  echo "      Grading is trace-only; installing the plugin does NOT rescue past runs — you must re-run after installing."
  echo "      One-time (interactive Claude Code):  /plugin marketplace add langchain-ai/langsmith-claude-code-plugins ; /plugin install"
fi

exit $rc
