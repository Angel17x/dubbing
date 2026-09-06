#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/xtts-server/.venv"
REQUIREMENTS="$ROOT/xtts-server/requirements.txt"

find_python() {
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; raise SystemExit(not ((3, 10) <= sys.version_info[:2] < (3, 15)))'; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON="$(find_python || true)"
if [[ -z "$PYTHON" ]]; then
  printf 'Se requiere Python 3.10–3.14.\n' >&2
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    printf 'Instálalo con: brew install python@3.13\n' >&2
  else
    printf 'Instala Python con el gestor de paquetes de tu distribución.\n' >&2
  fi
  exit 1
fi

printf 'Creando entorno XTTS con %s...\n' "$("$PYTHON" --version)"
"$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV/bin/python" -m pip install --requirement "$REQUIREMENTS"
"$VENV/bin/python" -c 'import fastapi, soundfile, torch, torchaudio, uvicorn; from TTS.api import TTS'

printf '\nEntorno XTTS instalado correctamente en %s\n' "$VENV"
