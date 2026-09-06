# Verifica la sintaxis de todos los JS de la extension con node --check
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$classic = @(
  'src\content\namespace.js',
  'src\content\vtt-parser.js',
  'src\content\page-hook.js',
  'src\content\net-hook.js',
  'src\content\net-hook-injector.js',
  'src\content\subtitles\generic.js',
  'src\content\subtitles\youtube.js',
  'src\content\subtitles\udemy.js',
  'src\content\translator.js',
  'src\content\tts.js',
  'src\content\overlay.js',
  'src\content\player-button.js',
  'src\content\engine.js',
  'src\content\content.js',
  'src\background\sw.js',
  'src\popup\popup.js'
)
$fail = 0
foreach ($f in $classic) {
  node --check (Join-Path $root $f) 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Output "ERROR: $f"; node --check (Join-Path $root $f); $fail++ }
  else { Write-Output "OK: $f" }
}
# offscreen.js es un modulo ES: se copia como .mjs para validarlo
$tmp = Join-Path $env:TEMP 'dubai-offscreen-check.mjs'
Copy-Item (Join-Path $root 'src\offscreen\offscreen.js') $tmp -Force
node --check $tmp 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output 'ERROR: src\offscreen\offscreen.js'; node --check $tmp; $fail++ }
else { Write-Output 'OK: src\offscreen\offscreen.js (modulo)' }
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Output ''
if ($fail -eq 0) { Write-Output 'TODOS LOS ARCHIVOS OK' } else { Write-Output "FALLOS: $fail" }
