@echo off
setlocal

echo === 1/6 Drawing the icons ===
call node tools\make-icon.mjs
if errorlevel 1 goto :fail

echo === 2/6 Compiling the microphone probe ===
call node tools\build-probe.mjs
if errorlevel 1 goto :fail

echo === 3/6 Building app (Vite/TS) ===
call npm run build
if errorlevel 1 goto :fail

echo === 4/6 Packaging Electron app (unpacked) ===
call npx electron-builder --win --dir
if errorlevel 1 goto :fail

echo === 5/6 Compiling installer (Inno Setup) ===
set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo Inno Setup not found. Install it from https://jrsoftware.org/isdl.php
  echo then re-run build.bat ^(or fix the ISCC path above^).
  goto :fail
)
"%ISCC%" installer\installer.iss
if errorlevel 1 goto :fail

echo === 6/6 Launching the new installer ===
rem Newest first, launch only that one - old version installers linger in the folder.
for /f "delims=" %%f in ('dir /b /o-d "installer-output\*Setup*.exe" 2^>nul') do (
  start "" "installer-output\%%f"
  goto :done
)
echo No installer found in installer-output\.
goto :fail

:done
echo === Build complete ===
goto :eof

:fail
echo BUILD FAILED - see the step above.
exit /b 1
