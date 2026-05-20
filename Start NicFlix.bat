@echo off
setlocal
cd /d "%~dp0"

echo Starting NicFlix...
echo.
echo Frontend: http://localhost:5182
echo Backend:  http://localhost:4000/api
echo.
echo Leave this window open while using NicFlix.
echo Press Ctrl+C in this window to stop the server.
echo.

npm run dev

pause
