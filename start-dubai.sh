#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${1:-llama3.1:8b}"
OLLAMA_LOG="$ROOT/ollama.log"
XTTS_LOG="$ROOT/xtts-server/server.log"
XTTS_ERROR_LOG="$ROOT/xtts-server/server-error.log"
PYTHON="$ROOT/xtts-server/.venv/bin/python"
REFERENCE="$ROOT/example_voices/ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3"

fail() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "No se encontró '$1' en PATH."
}

wait_http() {
  local url="$1"
  local seconds="${2:-60}"
  local deadline=$((SECONDS + seconds))

  until curl --silent --fail --max-time 3 "$url" >/dev/null 2>&1; do
    (( SECONDS >= deadline )) && return 1
    sleep 1
  done
}

stop_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
  fi

  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 2
  fi
}

require_command curl
require_command node
require_command ollama
if [[ ! -x "$PYTHON" ]]; then
  printf 'No existe el entorno XTTS; iniciando la instalación...\n'
  "$ROOT/scripts/setup-xtts.sh" ||
    fail "No se pudo instalar XTTS. Corrige el error anterior y vuelve a ejecutar."
fi
[[ -f "$REFERENCE" ]] || fail "No existe la voz de referencia: $REFERENCE"

EXTENSION_ID="$(node "$ROOT/scripts/find-extension-id.js" | awk 'NF { print; exit }')"
[[ -n "$EXTENSION_ID" ]] || fail "No se encontró el ID de DubAI. Recarga la extensión en Chrome y vuelve a ejecutar."
export OLLAMA_ORIGINS="chrome-extension://$EXTENSION_ID"

printf '=== DubAI: reinicio completo ===\n'
printf 'Origen autorizado: %s\n\n' "$OLLAMA_ORIGINS"

printf '[1/4] Reiniciando Ollama...\n'
if [[ "$(uname -s)" == "Darwin" ]]; then
  pkill -x "Ollama" 2>/dev/null || true
fi
pkill -x "ollama" 2>/dev/null || true
sleep 2
nohup ollama serve >"$OLLAMA_LOG" 2>&1 &
wait_http 'http://127.0.0.1:11434/api/tags' 30 ||
  fail "Ollama no respondió. Revisa $OLLAMA_LOG"

if ! ollama list | awk -v model="$MODEL" 'NR > 1 && $1 == model { found=1 } END { exit !found }'; then
  printf 'Descargando %s...\n' "$MODEL"
  ollama pull "$MODEL"
fi

printf '[2/4] Preparando %s...\n' "$MODEL"
while IFS= read -r running_model; do
  [[ -z "$running_model" || "$running_model" == "$MODEL" ]] && continue
  ollama stop "$running_model" >/dev/null 2>&1 || true
done < <(ollama ps | awk 'NR > 1 { print $1 }')

WARMUP_BODY="$("$PYTHON" -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"prompt":"","stream":False,"keep_alive":-1}))' "$MODEL")"
curl --silent --show-error --fail --max-time 600 \
  -H 'Content-Type: application/json' \
  -d "$WARMUP_BODY" \
  'http://127.0.0.1:11434/api/generate' >/dev/null

printf '[3/4] Reiniciando XTTS...\n'
stop_port 8020
export COQUI_TOS_AGREED=1
export DUBAI_VOICE_REFERENCE="$REFERENCE"
nohup "$PYTHON" -m uvicorn server:app \
  --app-dir "$ROOT/xtts-server" \
  --host 127.0.0.1 \
  --port 8020 \
  >"$XTTS_LOG" 2>"$XTTS_ERROR_LOG" &

wait_http 'http://127.0.0.1:8020/health' 60 ||
  fail "XTTS no respondió. Revisa $XTTS_ERROR_LOG"

HEALTH="$(curl --silent --show-error --fail --max-time 10 'http://127.0.0.1:8020/health')"
"$PYTHON" -c 'import json,sys; raise SystemExit(0 if json.loads(sys.argv[1]).get("reference_exists") else 1)' "$HEALTH" ||
  fail "XTTS inició, pero no encuentra el audio de referencia."

printf '[4/4] Cargando XTTS...\n'
curl --silent --show-error --fail --max-time 600 \
  -X POST 'http://127.0.0.1:8020/load' >/dev/null
HEALTH="$(curl --silent --show-error --fail --max-time 10 'http://127.0.0.1:8020/health')"
DEVICE="$("$PYTHON" -c 'import json,sys; h=json.loads(sys.argv[1]); print(h.get("gpu") or "CPU")' "$HEALTH")"

printf '\n=== DubAI listo ===\n'
printf 'Ollama: http://127.0.0.1:11434 (%s, cargado permanentemente)\n' "$MODEL"
printf 'XTTS:   http://127.0.0.1:8020 (%s, modelo cargado)\n' "$DEVICE"
printf 'Los servicios continuarán ejecutándose en segundo plano.\n'
