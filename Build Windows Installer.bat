@echo off
setlocal

cd /d "%~dp0"

echo Building NicFlix Windows installer...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on your PATH.
  echo.
  echo Install the LTS version of Node.js from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or is not on your PATH.
  echo.
  pause
  exit /b 1
)

echo Installing and updating npm packages...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Creating NSIS installer...
call npm run dist:win
if errorlevel 1 (
  echo.
  echo ERROR: Installer build failed.
  echo.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo Installer output is in the release folder.
echo.

pause
