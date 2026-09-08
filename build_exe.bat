@echo off
rem Build QuickSTEP.exe on Windows — a single file that needs no Python.
rem Run this from the folder that holds stepview.py, then send dist\QuickSTEP.exe
rem to anyone: it carries Python, viewer.html and the OpenCASCADE engine inside.
setlocal

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found on PATH. Install 64-bit Python 3.9-3.13 first.
    exit /b 1
)

echo === Installing build dependencies ===
python -m pip install --upgrade pip || exit /b 1
python -m pip install pyinstaller cascadio numpy || exit /b 1

echo === Building ===
python -m PyInstaller --clean --noconfirm quickstep.spec || exit /b 1

echo === Checking the result ===
dist\QuickSTEP.exe --check < nul

echo.
echo Done:  %CD%\dist\QuickSTEP.exe
echo Send that one file to a colleague - nothing else is needed.
endlocal
