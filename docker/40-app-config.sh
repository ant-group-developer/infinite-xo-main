#!/bin/sh
# Runs from the nginx image entrypoint before nginx starts.
# Writes the browser's runtime config from every VITE_* environment variable:
#   window.__APP_CONFIG__ = { "VITE_FIREBASE_API_KEY": "...", ... };
# Only put PUBLIC values here (Firebase web config is public by design).
set -eu

OUT=/usr/share/nginx/html/config.js

json_escape() {
  # backslash, double quote, and "<" (so the value can never close a <script>)
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g' | tr -d '\n\r'
}

{
  echo "// Generated at container start by 40-app-config.sh – do not edit."
  echo "window.__APP_CONFIG__ = {"
  env | grep -E '^VITE_[A-Z0-9_]+=' | sort | while IFS='=' read -r key value; do
    printf '  "%s": "%s",\n' "$key" "$(json_escape "$value")"
  done
  echo "};"
} > "$OUT"

count=$(grep -c '^  "VITE_' "$OUT" || true)
echo "40-app-config.sh: wrote $OUT with $count value(s)"
if ! grep -q '"VITE_FIREBASE_API_KEY"' "$OUT"; then
  echo "40-app-config.sh: no Firebase config set – online features use the in-browser local backend"
fi
