# DubAI — descarga las librerías locales necesarias (transformers.js + binarios WASM de onnxruntime)
# Uso:  powershell -ExecutionPolicy Bypass -File scripts\setup-libs.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$lib = Join-Path $root 'lib'
New-Item -ItemType Directory -Force -Path $lib | Out-Null

$version = '3.8.1'
$base = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@$version/dist"

$files = @(
  'transformers.min.js',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs'
)

foreach ($f in $files) {
  $out = Join-Path $lib $f
  Write-Host "Descargando $f ..."
  Invoke-WebRequest -Uri "$base/$f" -OutFile $out
  Write-Host "  OK -> $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
}

Write-Host ''
Write-Host 'Listo. Carga la extension en chrome://extensions (modo desarrollador > Cargar sin empaquetar).'
Write-Host 'Nota: los modelos de IA (traduccion/Whisper) se descargan de Hugging Face la primera vez que se usan.'
