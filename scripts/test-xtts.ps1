$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'xtts-server\test-roger.wav'
$body = @{
  text = 'Hola. Esta es una prueba local de la voz para el doblaje en español.'
  language = 'es'
  reference = 'C:\Users\PC\Downloads\ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3'
} | ConvertTo-Json

$watch = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:8020/tts' -ContentType 'application/json' -Body $body -OutFile $out -TimeoutSec 300
$watch.Stop()
Write-Output ('Audio: ' + $out)
Write-Output ('Tamaño: ' + (Get-Item $out).Length + ' bytes')
Write-Output ('Tiempo: ' + [math]::Round($watch.Elapsed.TotalSeconds, 2) + ' s')
