@echo off
rem ============================================================================
rem  dsh-pet desktop pet - usage
rem
rem  Everything lives in this folder. Copy the whole folder to another PC (or a
rem  USB stick) and it runs there: Node, Electron, the 106 animations and your
rem  settings all travel with it. Nothing is installed into Windows, nothing is
rem  written to the registry, and your ~/.dsh is never touched.
rem
rem  Uninstall = delete this folder.
rem
rem  ASCII-only on purpose: cmd.exe parses .cmd with the OEM code page (GBK on a
rem  Chinese Windows), so UTF-8 text in this file would be mangled and break it.
rem ============================================================================

setlocal

echo.
echo   ==========================================================
echo      dsh-pet desktop pet  -  portable build
echo   ==========================================================
echo.

if not exist "%~dp0app\lib\standalone.js" (
  echo   [ERROR] app\lib\standalone.js is missing.
  echo           This folder is incomplete - copy the WHOLE folder, not just the exe.
  echo.
  pause
  exit /b 1
)

rem The pet is already up? The launcher refuses to start a second copy, so just
rem tell the user instead of appearing to do nothing.
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if not errorlevel 1 (
  echo   The pet seems to be running already.
  echo   Close it first ^(right-click the tray icon, or end electron.exe in Task Manager^).
  echo.
  pause
  exit /b 0
)

echo   Starting the pet...
echo.
start "" "%~dp0大肥鱼桌宠.exe"
echo   Started. To stop it: end electron.exe in Task Manager.
echo.

endlocal
