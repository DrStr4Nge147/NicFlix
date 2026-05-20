@echo off
setlocal

cd /d "%~dp0"

echo Updating NicFlix...
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on your PATH.
  echo.
  echo Please install Git from:
  echo https://git-scm.com/downloads
  echo.
  pause
  exit /b 1
)

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

if not exist ".git" (
  echo ERROR: This folder is not a Git checkout.
  echo.
  echo Download or clone NicFlix from GitHub, then run update.bat again.
  echo.
  pause
  exit /b 1
)

echo Checking GitHub for updates...
call git fetch origin
if errorlevel 1 (
  echo.
  echo ERROR: Could not fetch updates from GitHub.
  echo Check your internet connection and GitHub access, then try again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%B

if "%CURRENT_BRANCH%"=="HEAD" (
  echo.
  echo ERROR: You are not currently on a branch.
  echo Switch back to the main branch, then run update.bat again.
  echo.
  pause
  exit /b 1
)

git rev-parse --verify "origin/%CURRENT_BRANCH%" >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Could not find origin/%CURRENT_BRANCH% on GitHub.
  echo.
  pause
  exit /b 1
)

git diff --quiet
if errorlevel 1 (
  echo.
  echo WARNING: You have local app changes that are not committed.
  echo Git may refuse to update if those changes conflict with GitHub.
  echo.
  choice /c YN /m "Continue with the update anyway"
  if errorlevel 2 (
    echo.
    echo Update cancelled. Your files were left unchanged.
    echo.
    pause
    exit /b 1
  )
)

git diff --cached --quiet
if errorlevel 1 (
  echo.
  echo WARNING: You have staged app changes that are not committed.
  echo Git may refuse to update if those changes conflict with GitHub.
  echo.
  choice /c YN /m "Continue with the update anyway"
  if errorlevel 2 (
    echo.
    echo Update cancelled. Your files were left unchanged.
    echo.
    pause
    exit /b 1
  )
)

for /f "tokens=1,2" %%A in ('git rev-list --left-right --count HEAD...origin/%CURRENT_BRANCH%') do (
  set LOCAL_ONLY=%%A
  set REMOTE_ONLY=%%B
)

if "%REMOTE_ONLY%"=="0" (
  echo.
  echo NicFlix is already up to date.
) else (
  if not "%LOCAL_ONLY%"=="0" (
    echo.
    echo ERROR: Your branch has local commits that are not on GitHub.
    echo Update manually with Git so those commits are not lost.
    echo.
    pause
    exit /b 1
  )

  echo.
  echo Downloading latest NicFlix version from GitHub...
  call git pull --ff-only origin "%CURRENT_BRANCH%"
  if errorlevel 1 (
    echo.
    echo ERROR: Git update failed.
    echo Resolve the Git error shown above, then run update.bat again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Installing npm packages...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  echo Check the messages above, then run update.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Building the app...
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: App build failed.
  echo Check the messages above, then run update.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo Update complete.
echo.
echo Next step:
echo Double click "Start NicFlix.bat" to run the latest version.
echo.

pause
