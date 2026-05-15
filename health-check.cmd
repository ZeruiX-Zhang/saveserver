@echo off
setlocal

set "ROOT=%~dp0"

if defined WAREHOUSE_APP_NODE (
  set "NODE_EXE=%WAREHOUSE_APP_NODE%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found on PATH.
    echo Install Node.js from https://nodejs.org/ or set WAREHOUSE_APP_NODE to a node.exe path.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

"%NODE_EXE%" "%ROOT%scripts\health-check.js"
echo.
if errorlevel 1 (
  echo Health check failed.
) else (
  echo Health check passed.
)
pause
endlocal
