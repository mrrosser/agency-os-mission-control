#!/usr/bin/env bash
set -euo pipefail

# RT Infinite Loop gate runner for this repo.
# Writes a human-readable report to docs/reports/latest-run.md and stores artifacts under .tmp/.

RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$RANDOM}"
export RUN_ID

REPORT="${RT_REPORT_PATH:-docs/reports/latest-run.md}"
export REPORT

SKILL_SCANNER_CMD="skill-scanner"
MCP_SCANNER_CMD="mcp-scanner"

if [[ -d "/mnt/data" && -w "/mnt/data" ]]; then
  ARTIFACTS_DIR="${RT_ARTIFACTS_DIR:-/mnt/data/rt-loop-$RUN_ID}"
else
  ARTIFACTS_DIR="${RT_ARTIFACTS_DIR:-.tmp/artifacts/rt-loop-$RUN_ID}"
fi
export ARTIFACTS_DIR

mkdir -p "$(dirname "$REPORT")" "$ARTIFACTS_DIR"

# "latest" report should reflect only the current run.
cat >"$REPORT" <<EOF
# RT Loop Report

- RUN_ID: \`$RUN_ID\`
- Artifacts: \`$ARTIFACTS_DIR\`

EOF

log() {
  local msg="$1"
  printf '[%s] RUN_ID=%s %s\n' "$(date -Iseconds)" "$RUN_ID" "$msg" | tee -a "$REPORT"
}

sanitize_name() {
  local raw="$1"
  raw="${raw//[^a-zA-Z0-9_]/_}"
  printf '%s' "$raw"
}

run() {
  local name="$1"
  local cmd="$2"
  log "gate=$name cmd=$cmd"
  set +e
  bash -lc "$cmd"
  local ec=$?
  set -e
  if [[ $ec -ne 0 ]]; then
    log "gate=$name result=FAIL exit=$ec"
    return $ec
  fi
  log "gate=$name result=PASS"
}

log_tool_version() {
  local tool="$1"
  local version_cmd="$2"
  if command -v "$tool" >/dev/null 2>&1; then
    local version
    version="$(bash -lc "$version_cmd" 2>/dev/null | head -n 1 | tr -d '\r' || true)"
    if [[ -n "$version" ]]; then
      log "tool=$tool version=\"$version\""
    fi
  fi
}

bootstrap_cisco_scanners() {
  if [[ "${RT_ENABLE_CISCO_SCANNERS:-0}" != "1" ]]; then
    log "gate=cisco_bootstrap result=SKIP reason=disabled"
    return 0
  fi

  export PATH="$HOME/.local/bin:$PATH"
  if command -v skill-scanner >/dev/null 2>&1 && command -v mcp-scanner >/dev/null 2>&1; then
    SKILL_SCANNER_CMD="$(command -v skill-scanner)"
    MCP_SCANNER_CMD="$(command -v mcp-scanner)"
    log "gate=cisco_bootstrap result=PASS mode=preinstalled"
    log "tool=skill-scanner path=$SKILL_SCANNER_CMD"
    log "tool=mcp-scanner path=$MCP_SCANNER_CMD"
    log_tool_version "skill-scanner" "\"$SKILL_SCANNER_CMD\" --help"
    log_tool_version "mcp-scanner" "\"$MCP_SCANNER_CMD\" --help"
    return 0
  fi

  if [[ "${RT_AUTO_INSTALL_CISCO_SCANNERS:-0}" != "1" ]]; then
    log "gate=cisco_bootstrap result=FAIL reason=scanners_missing_auto_install_disabled"
    return 1
  fi

  if command -v uv >/dev/null 2>&1; then
    run "install_cisco_scanners" "uv tool install --upgrade cisco-ai-skill-scanner && uv tool install --upgrade cisco-ai-mcp-scanner"
  elif command -v python3 >/dev/null 2>&1; then
    local venv_dir="${RT_CISCO_SCANNERS_VENV:-$ARTIFACTS_DIR/.venv-cisco-scanners}"
    run "install_cisco_scanners" "python3 -m venv \"$venv_dir\" && \"$venv_dir/bin/python\" -m pip install --upgrade pip && \"$venv_dir/bin/pip\" install --upgrade cisco-ai-skill-scanner cisco-ai-mcp-scanner"
    export PATH="$venv_dir/bin:$PATH"
  elif command -v python >/dev/null 2>&1; then
    local venv_dir="${RT_CISCO_SCANNERS_VENV:-$ARTIFACTS_DIR/.venv-cisco-scanners}"
    run "install_cisco_scanners" "python -m venv \"$venv_dir\" && \"$venv_dir/bin/python\" -m pip install --upgrade pip && \"$venv_dir/bin/pip\" install --upgrade cisco-ai-skill-scanner cisco-ai-mcp-scanner"
    export PATH="$venv_dir/bin:$PATH"
  else
    log "gate=cisco_bootstrap result=FAIL reason=python_runtime_missing"
    return 1
  fi

  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v skill-scanner >/dev/null 2>&1; then
    log "gate=cisco_bootstrap result=FAIL reason=skill_scanner_install_failed"
    return 1
  fi
  if ! command -v mcp-scanner >/dev/null 2>&1; then
    log "gate=cisco_bootstrap result=FAIL reason=mcp_scanner_install_failed"
    return 1
  fi

  SKILL_SCANNER_CMD="$(command -v skill-scanner)"
  MCP_SCANNER_CMD="$(command -v mcp-scanner)"
  log "gate=cisco_bootstrap result=PASS mode=installed"
  log "tool=skill-scanner path=$SKILL_SCANNER_CMD"
  log "tool=mcp-scanner path=$MCP_SCANNER_CMD"
  log_tool_version "skill-scanner" "\"$SKILL_SCANNER_CMD\" --help"
  log_tool_version "mcp-scanner" "\"$MCP_SCANNER_CMD\" --help"
}

run_cisco_skill_scan() {
  local scan_paths="${RT_SKILL_SCAN_PATHS:-.agents/skills .codex/skills skills}"
  local scanned=0
  for path in $scan_paths; do
    if [[ -d "$path" ]]; then
      scanned=1
      local safe_name
      safe_name="$(sanitize_name "$path")"
      local output="$ARTIFACTS_DIR/cisco-skill-scan-${safe_name}.sarif"
      run "cisco_skill_scan_${safe_name}" "\"$SKILL_SCANNER_CMD\" scan-all \"$path\" --recursive --use-behavioral --fail-on-findings --format sarif --output \"$output\""
      log "artifact=$output"
    fi
  done
  if [[ $scanned -eq 0 ]]; then
    log "gate=cisco_skill_scan result=SKIP reason=no_skill_directories"
  fi
}

run_cisco_mcp_behavioral_scan() {
  local scan_paths="${RT_MCP_SCAN_PATHS:-}"
  local scanned=0
  shopt -s nullglob
  for pattern in $scan_paths; do
    for path in $pattern; do
      if [[ -d "$path" || -f "$path" ]]; then
        scanned=1
        local safe_name
        safe_name="$(sanitize_name "$path")"
        local output="$ARTIFACTS_DIR/cisco-mcp-scan-${safe_name}.json"
        run "cisco_mcp_scan_${safe_name}" "\"$MCP_SCANNER_CMD\" behavioral \"$path\" --format raw --output \"$output\""
        if grep -Eiq '"is_safe"[[:space:]]*:[[:space:]]*false|"status"[[:space:]]*:[[:space:]]*"UNSAFE"|UNSAFE' "$output"; then
          log "gate=cisco_mcp_scan_${safe_name} result=FAIL reason=unsafe_findings output=$output"
          shopt -u nullglob
          return 1
        fi
        log "gate=cisco_mcp_scan_${safe_name} result=PASS_SAFE output=$output"
      fi
    done
  done
  shopt -u nullglob
  if [[ $scanned -eq 0 ]]; then
    log "gate=cisco_mcp_scan result=SKIP reason=no_mcp_paths"
  fi
}

on_exit() {
  local ec=$?
  if [[ $ec -eq 0 ]]; then
    log "end status=PASS artifacts_dir=$ARTIFACTS_DIR"
  else
    log "end status=FAIL exit=$ec artifacts_dir=$ARTIFACTS_DIR"
  fi
}
trap on_exit EXIT

log "start artifacts_dir=$ARTIFACTS_DIR"
log_tool_version "node" "node --version"
log_tool_version "npm" "npm --version"

# Repo-specific defaults (override in CI/local with env vars if needed).
FORMAT_CMD="${RT_FORMAT_CMD:-npm run lint}"
UNIT_CMD="${RT_UNIT_CMD:-npm run test:unit}"
SMOKE_CMD="${RT_SMOKE_CMD:-npm run test:smoke}"
BUILD_CMD="${RT_BUILD_CMD:-npm run build}"
SECURITY_CMD="${RT_SECURITY_CMD:-npm audit --audit-level=high}"

run "format_lint" "$FORMAT_CMD"
run "unit" "$UNIT_CMD"
run "smoke" "$SMOKE_CMD"
run "build" "$BUILD_CMD"
run "security" "$SECURITY_CMD"

if [[ -n "${RT_SECRETS_CMD:-}" ]]; then
  run "secrets" "$RT_SECRETS_CMD"
elif command -v gitleaks >/dev/null 2>&1; then
  run "secrets" "gitleaks dir --source . --redact --report-format sarif --report-path \"$ARTIFACTS_DIR/gitleaks.sarif\""
else
  log "gate=secrets result=SKIP reason=gitleaks_not_installed"
fi

bootstrap_cisco_scanners
run_cisco_skill_scan
run_cisco_mcp_behavioral_scan
