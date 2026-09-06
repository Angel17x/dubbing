# Diagnostica e inicia Ollama, luego lista modelos
$ErrorActionPreference = 'Continue'

# Permite que DubAI llame a la API local. Algunas versiones de Ollama no
# aplican correctamente el comodín chrome-extension://*, por eso se usa el ID.
$extensionId = (& node (Join-Path $PSScriptRoot 'find-extension-id.js') | Select-Object -First 1).Trim()
if (-not $extensionId) {
  Write-Output 'No se pudo encontrar el ID de DubAI. Recarga la extension y vuelve a ejecutar.'
  exit 1
}
$allowedOrigin = 'chrome-extension://' + $extensionId
[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $allowedOrigin, 'User')
$env:OLLAMA_ORIGINS = $allowedOrigin
Write-Output ('Origen autorizado: ' + $allowedOrigin)

# 1) ¿Está instalado?
$cmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($cmd) {
  Write-Output ('ollama en PATH: ' + $cmd.Source)
} else {
  $app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $app) {
    Write-Output ('ollama instalado en: ' + $app)
    $env:Path = $env:Path + ';' + (Split-Path $app)
  } else {
    Write-Output 'OLLAMA NO INSTALADO (o no encontrado)'
    exit 1
  }
}

# 2) Reiniciar para que el proceso herede OLLAMA_ORIGINS. La aplicación de
# bandeja mantiene su propio "ollama serve", así que también debe cerrarse.
$tray = Get-Process -Name 'ollama app' -ErrorAction SilentlyContinue
if ($tray) {
  Write-Output 'Cerrando Ollama de la bandeja (tenia la configuracion anterior)...'
  $tray | Stop-Process -Force
  Start-Sleep -Seconds 2
}
$running = Get-Process -Name 'ollama' -ErrorAction SilentlyContinue
if ($running) {
  Write-Output 'Reiniciando Ollama para aplicar OLLAMA_ORIGINS...'
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}
Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
Start-Sleep -Seconds 4

# 3) Probar de nuevo y listar modelos
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5
  Write-Output 'OLLAMA CORRIENDO ✔'
  if ($r.models -and $r.models.Count -gt 0) {
    foreach ($m in $r.models) { Write-Output (' - ' + $m.name) }
  } else {
    Write-Output '(sin modelos instalados — falta: ollama pull qwen2.5:3b)'
  }
} catch {
  Write-Output ('OLLAMA SIGUE SIN RESPONDER: ' + $PSItem.Exception.Message)
}
