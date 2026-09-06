param(
  [string]$OllamaModel = 'llama3.1:8b'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Wait-Http {
  param([string]$Url, [int]$Seconds = 60)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      return Invoke-RestMethod -Uri $Url -TimeoutSec 3
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "Tiempo agotado esperando $Url"
}

Write-Output '=== DubAI: reinicio completo ==='

# 1. Ollama: start-ollama configura el origen exacto, cierra la aplicación
# antigua y levanta una única instancia de `ollama serve`.
Write-Output ''
Write-Output '[1/4] Reiniciando Ollama...'
& (Join-Path $PSScriptRoot 'start-ollama.ps1')
$null = Wait-Http -Url 'http://127.0.0.1:11434/api/tags' -Seconds 30

# Descargar el modelo si todavía no está instalado.
$tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
$installed = @($tags.models | ForEach-Object { $_.name })
if ($installed -notcontains $OllamaModel) {
  Write-Output "Descargando $OllamaModel..."
  & ollama pull $OllamaModel
  if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar $OllamaModel" }
}

# Descargar de GPU otros modelos para evitar lentitud por falta de VRAM.
Write-Output "[2/4] Preparando $OllamaModel en GPU..."
try {
  $running = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 10
  foreach ($entry in @($running.models)) {
    if ($entry.name -and $entry.name -ne $OllamaModel) {
      $unload = @{ model = $entry.name; keep_alive = 0 } | ConvertTo-Json
      $null = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -ContentType 'application/json' -Body $unload -TimeoutSec 60
    }
  }
} catch {
  Write-Warning ('No se pudieron descargar modelos secundarios: ' + $_.Exception.Message)
}

$warmup = @{
  model = $OllamaModel
  prompt = ''
  stream = $false
  keep_alive = -1
} | ConvertTo-Json
$null = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -ContentType 'application/json' -Body $warmup -TimeoutSec 600

# 2. XTTS: cerrar exactamente el proceso que escucha en el puerto 8020.
Write-Output '[3/4] Reiniciando XTTS...'
$listener = Get-NetTCPConnection -LocalPort 8020 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $listener | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

$stdout = Join-Path $root 'xtts-server\server.log'
$stderr = Join-Path $root 'xtts-server\server-error.log'
Start-Process `
  -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'start-xtts.ps1')) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

$health = Wait-Http -Url 'http://127.0.0.1:8020/health' -Seconds 60
if (-not $health.reference_exists) {
  throw 'XTTS inició, pero no encuentra el audio de referencia.'
}

Write-Output '[4/4] Cargando XTTS en GPU...'
$null = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8020/load' -TimeoutSec 600
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8020/health' -TimeoutSec 10

Write-Output ''
Write-Output '=== DubAI listo ==='
Write-Output "Ollama: http://127.0.0.1:11434 ($OllamaModel, cargado permanentemente)"
Write-Output "XTTS:   http://127.0.0.1:8020 ($($health.gpu), modelo cargado)"
Write-Output 'Ya puedes cerrar esta ventana y usar la extensión.'

