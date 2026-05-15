@echo off
chcp 65001 >nul
setlocal

echo.
echo 正在停止仓位管理系统后台服务...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conn = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($conn) {" ^
    "$conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {" ^
      "try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('  已停止进程 PID=' + $_) -ForegroundColor Green }" ^
      "catch { Write-Host ('  无法停止进程 PID=' + $_ + ': ' + $_.Exception.Message) -ForegroundColor Yellow }" ^
    "}" ^
  "} else {" ^
    "Write-Host '  服务器未在运行(端口 4173 空闲)。' -ForegroundColor Gray" ^
  "}"

echo.
echo 完成。窗口将在 3 秒后关闭。
timeout /t 3 /nobreak >nul
endlocal
