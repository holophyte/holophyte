#!/usr/bin/env bash
# Resolve the real Bun binary, skipping any node_modules/.bin shim.
# Source this file — it exports BUN_BIN and a shim-free PATH.

path_without_node_modules_bins() {
  local part
  local result=""
  while IFS= read -r part; do
    case "$part" in
      */node_modules/.bin) continue ;;
    esac
    if [ -z "$result" ]; then
      result="$part"
    else
      result="$result:$part"
    fi
  done < <(printf '%s' "$PATH" | tr ':' '\n')
  printf '%s' "$result"
}

REAL_PATH="$(path_without_node_modules_bins)"
BUN_BIN="$(PATH="$REAL_PATH" command -v bun || true)"
if [ -z "$BUN_BIN" ]; then
  echo "Error: Could not find Bun outside node_modules/.bin"
  exit 1
fi
export PATH="$REAL_PATH"
