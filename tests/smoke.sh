#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
note() { printf '%-36s %s\n' "$1" "$2"; }
ok() { note "$1" ok; }
bad() { note "$1" "FAIL: ${2:-}"; fail=1; }

if node -e 'JSON.parse(require("fs").readFileSync("package.json", "utf8"))'; then ok "package.json valid"; else bad "package.json valid"; fi

if grep -q '"pi-package"' package.json && grep -q '"./extensions"' package.json; then ok "pi manifest present"; else bad "pi manifest present"; fi

if [ -x bin/resolve-openrouter-key.mjs ]; then ok "key resolver executable"; else bad "key resolver executable"; fi

if grep -q 'registerProvider(PROVIDER_ID' extensions/pi-fusion.ts && grep -q 'openrouter/fusion' extensions/pi-fusion.ts; then ok "provider registers fusion"; else bad "provider registers fusion"; fi

if grep -q 'fusion:doctor' extensions/pi-fusion.ts \
  && grep -q 'fusion:setup' extensions/pi-fusion.ts \
  && grep -q 'fusion:help' extensions/pi-fusion.ts \
  && grep -q 'fusion:ask' extensions/pi-fusion.ts \
  && grep -q 'fusion:review-diff' extensions/pi-fusion.ts \
  && grep -q 'fusion:review-file' extensions/pi-fusion.ts; then
  ok "commands present"
else
  bad "commands present"
fi

for mode in budget quality frontier; do
  if grep -q "pi-fusion-$mode" extensions/pi-fusion.ts README.md; then ok "mode present: $mode"; else bad "mode present: $mode"; fi
done

if command -v pi >/dev/null 2>&1; then
  out="$(PI_FUSION_CONFIG="$ROOT/.missing-pi-fusion.json" pi -e "$ROOT" --list-models fusion 2>&1 || true)"
  if [[ "$out" == *"openrouter/fusion"* && "$out" == *"@preset/pi-fusion-budget"* && "$out" == *"@preset/pi-fusion-quality"* && "$out" == *"@preset/pi-fusion-frontier"* ]]; then
    ok "pi loads fusion models"
  else
    bad "pi loads fusion models" "$out"
  fi
else
  note "pi loads fusion models" "skipped (pi not on PATH)"
fi

if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck tests/smoke.sh; then ok "shellcheck"; else bad "shellcheck"; fi
else
  note "shellcheck" "skipped"
fi

printf '%s\n' "----"
if [ "$fail" -eq 0 ]; then
  echo "smoke: ALL PASS"
else
  echo "smoke: FAILURES above"
fi
exit "$fail"
