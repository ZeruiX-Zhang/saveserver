@echo off
chcp 65001 >nul
setlocal

echo.
echo === 安装桌面快捷方式 ===
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"

if errorlevel 1 (
  echo.
  echo 安装失败,请检查上方错误信息。
  pause
  exit /b 1
)

echo.
pause
endlocal
