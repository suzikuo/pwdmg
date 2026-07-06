@echo off
setlocal
set "REPO_DIR=%~dp0.."
set "LOG_DIR=%REPO_DIR%\native-host"
set "LOG_FILE=%LOG_DIR%\native-host-error.log"
set "PYTHON=%REPO_DIR%\.env\Scripts\python.exe"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul
cd /d "%REPO_DIR%" >nul 2>nul

if not exist "%PYTHON%" (
  echo [%date% %time%] Python not found: %PYTHON%>>"%LOG_FILE%"
  exit /b 1
)

"%PYTHON%" -m pwdmg_core.native_host 2>>"%LOG_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [%date% %time%] Native host exited with code %EXIT_CODE%.>>"%LOG_FILE%"
exit /b %EXIT_CODE%
