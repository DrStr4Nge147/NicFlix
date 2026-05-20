@echo off
setlocal

cd /d "%~dp0"

echo Installing NicFlix...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on your PATH.
  echo.
  echo Please install the LTS version of Node.js from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or is not on your PATH.
  echo.
  echo npm is normally installed with Node.js. Reinstall Node.js from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "apps\server\.env" (
  if exist "apps\server\.env.example" (
    echo Creating apps\server\.env from apps\server\.env.example...
    copy "apps\server\.env.example" "apps\server\.env" >nul
  ) else (
    echo WARNING: apps\server\.env.example was not found.
    echo Skipping .env creation.
  )
) else (
  echo apps\server\.env already exists. Leaving it unchanged.
)

if not exist "config.json" (
  if exist "config.example.json" (
    echo Creating config.json from config.example.json...
    copy "config.example.json" "config.json" >nul
  ) else (
    echo WARNING: config.example.json was not found.
    echo Skipping config.json creation.
  )
) else (
  echo config.json already exists. Leaving it unchanged.
)

echo.
echo Installing npm packages...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  echo Check the messages above, then run install.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Installation complete.
echo.
echo Next steps:
echo 1. Edit apps\server\.env if you want to add a TMDB API key.
echo 2. Double click "Start NicFlix.bat" to run the app.
echo 3. Open Admin in NicFlix and add your media folders.
echo.

pause
