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

set "APP_URL=http://127.0.0.1:4173/index.html?v=20260430-export-01"

echo Starting local server...
start "Warehouse PWA Server" cmd /k ""%NODE_EXE%" "%ROOT%server.js""
timeout /t 2 /nobreak >nul
start "" %APP_URL%
echo Browser launch requested: %APP_URL%
echo Close the window named "Warehouse PWA Server" to stop the server.
endlocal
