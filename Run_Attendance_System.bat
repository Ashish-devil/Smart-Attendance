@echo off
REM Smart Attendance System - Launcher
echo.
echo ============================================
echo    Smart Attendance System
echo ============================================
echo.

REM Set paths
set "APP_DIR=%~dp0release\win-unpacked"
set "APP_EXE=%APP_DIR%\Smart Attendance.exe"

REM Check if executable exists
if not exist "%APP_EXE%" (
    echo ERROR: Application executable not found!
    echo Expected location: "%APP_EXE%"
    echo.
    echo Please ensure the app has been built properly.
    pause
    exit /b 1
)

REM Launch the application
echo Starting Smart Attendance System...
echo.
cd /d "%APP_DIR%"
start "" "%APP_EXE%"
exit /b 0