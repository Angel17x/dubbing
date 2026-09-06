$body = @{
  model = 'qwen2.5:3b'
  stream = $false
  format = 'json'
  keep_alive = '30m'
  options = @{ temperature = 0.1; num_ctx = 4096 }
  messages = @(
    @{
      role = 'system'
      content = 'Eres un traductor profesional de subtítulos. Traduce del alemán al español. Los elementos son fragmentos consecutivos de una misma narración: usa los elementos vecinos como contexto. Cada salida debe estar completamente en español; no conserves palabras alemanas salvo nombres propios y términos técnicos. Devuelve únicamente JSON con este formato exacto: {"translations":["traducción"]}.'
    },
    @{
      role = 'user'
      content = '["mit sich, so dass dies in Version 1 beschlossen wurde. 2 für die Veröffentlichung von Kubernetes, um Dockershim vollständig zu entfernen, und so wurde"]'
    }
  )
} | ConvertTo-Json -Depth 6

$r = Invoke-RestMethod -Uri 'http://localhost:11434/api/chat' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
Write-Output $r.message.content
