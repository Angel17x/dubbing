# Prueba real de traducción con Ollama (mismo payload que usa la extensión)
$ErrorActionPreference = 'Stop'

$batch = @(
  'So now let''s see how we can create a new Angular 21 project.',
  'First, open your terminal and run the following command.',
  'This will install all the dependencies we need for the course.'
)

$body = @{
  model      = 'qwen2.5:3b'
  stream     = $false
  format     = 'json'
  keep_alive = '30m'
  options    = @{ temperature = 0.2; num_ctx = 8192 }
  messages   = @(
    @{
      role    = 'system'
      content = 'Eres un traductor profesional de subtítulos, del inglés al español. Responde ÚNICAMENTE con un array JSON de strings, con exactamente la misma cantidad de elementos y el mismo orden que la entrada. Sin numeración, sin comentarios, sin markdown. Mantén nombres propios y usa lenguaje natural hablado, conciso (es para doblaje).'
    },
    @{
      role    = 'user'
      content = 'Traduce estos subtítulos del inglés al español:' + "`n" + ($batch | ConvertTo-Json -Compress)
    }
  )
} | ConvertTo-Json -Depth 6

Write-Output 'Enviando lote de prueba a Ollama (qwen2.5:3b)...'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$r = Invoke-RestMethod -Uri 'http://localhost:11434/api/chat' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
$sw.Stop()
Write-Output ('Tiempo: ' + [math]::Round($sw.Elapsed.TotalSeconds, 1) + ' s')
Write-Output '--- respuesta ---'
Write-Output $r.message.content
