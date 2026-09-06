@echo off
cd /d "%~dp0"
echo Iniciando Ollama y XTTS para DubAI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
echo.
if errorlevel 1 (
  echo DubAI no pudo iniciar todos los servicios. Revisa el error anterior.
) else (
  echo Servicios iniciados correctamente.
)
pause
