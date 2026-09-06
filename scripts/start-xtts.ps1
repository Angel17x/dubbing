$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root 'xtts-server\.venv\Scripts\python.exe'
$server = Join-Path $root 'xtts-server\server.py'
$reference = Join-Path $root 'example_voices\ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3'

if (-not (Test-Path $python)) {
  throw 'No existe el entorno XTTS. Ejecuta la instalación primero.'
}
if (-not (Test-Path $reference)) {
  throw ('No existe la voz de referencia: ' + $reference)
}

$env:COQUI_TOS_AGREED = '1'
$env:DUBAI_VOICE_REFERENCE = $reference
# Recargar el PATH de usuario para encontrar las DLL compartidas de FFmpeg.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')

Write-Output 'Iniciando DubAI XTTS en http://127.0.0.1:8020 ...'
Write-Output 'La primera carga descarga el modelo XTTS (~1.8 GB).'
& $python -m uvicorn server:app --app-dir (Split-Path $server) --host 127.0.0.1 --port 8020
