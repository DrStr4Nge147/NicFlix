@echo off
setlocal

set PORTS=4000 6000

echo Stopping NicFlix ports...
echo.

for %%P in (%PORTS%) do (
  echo Checking port %%P...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('Stopping process ' + $_ + ' on port %%P'); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
)

echo.
echo Done.
pause
