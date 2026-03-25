@echo off
echo Creating desktop shortcut for Smart Attendance System...
echo.

set "TARGET=%~dp0release\win-unpacked\Smart Attendance.exe"
set "SHORTCUT=%USERPROFILE%\Desktop\Smart Attendance.lnk"
set "WORKINGDIR=%~dp0release\win-unpacked"
set "ICON=%~dp0release\win-unpacked\Smart Attendance.exe"

echo Target: %TARGET%
echo Shortcut: %SHORTCUT%
echo Working Directory: %WORKINGDIR%
echo.

powershell "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%WORKINGDIR%'; $s.IconLocation = '%ICON%'; $s.Description = 'Smart Attendance System with Facial Recognition'; $s.Save()"

echo.
echo Desktop shortcut created successfully!
echo You can now double-click the "Smart Attendance" icon on your desktop to run the app.
echo.
pause