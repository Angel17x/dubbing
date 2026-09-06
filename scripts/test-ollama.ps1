# Comprueba si Ollama está corriendo y lista los modelos instalados
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5
  Write-Output 'OLLAMA CORRIENDO'
  if ($r.models -and $r.models.Count -gt 0) {
    foreach ($m in $r.models) { Write-Output (' - ' + $m.name) }
  } else {
    Write-Output '(sin modelos instalados)'
  }
} catch {
  Write-Output ('OLLAMA NO RESPONDE: ' + $PSItem.Exception.Message)
}
