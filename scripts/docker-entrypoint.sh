#!/bin/sh
set -eu

ensure_writable_path() {
  target_path="$1"
  target_dir=$(dirname "$target_path")

  mkdir -p "$target_dir"

  if [ ! -e "$target_path" ]; then
    : > "$target_path"
  fi

  chown -R node:node "$target_dir"
}

ensure_writable_path "${RULE_OVERRIDES_PATH:-logs/rule-overrides.json}"
ensure_writable_path "${NOTIFICATION_LOG_PATH:-logs/notifications.log}"

exec su-exec node "$@"