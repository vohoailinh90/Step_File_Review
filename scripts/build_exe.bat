@echo off
setlocal
REM ================================================================
REM  QuickSTEP -- Windows EXE build (PyInstaller)
REM
REM  Run on a Windows PC that has 64-bit Python 3.9-3.13. Double-click this
REM  file, or run it from a console. It builds dist\QuickSTEP\, a folder that
REM  runs on any 64-bit Windows PC with no Python installed: copy the whole
REM  folder to users (zip it). Modelled on DocumentAIEditor's build_exe.bat.
REM
REM  ONE FOLDER, NOT ONE FILE, AND THAT IS DELIBERATE. The STEP engine
REM  (cascadio = OpenCASCADE) is well over 100 MB of DLLs. A --onefile exe
REM  unpacks all of it to a temp folder on every launch, so every start is
REM  slow, and antivirus scanners flag self-extracting exes far more often.
REM
REM  CONSOLE, NOT --windowed. QuickSTEP is a small local server: the console
REM  window shows the viewer URL and conversion progress, and closing it (or
REM  Ctrl+C) stops the server. A windowed build would leave it running unseen.
REM
REM  viewer.html IS BUNDLED INSIDE (--add-data). stepview.py looks for it next
REM  to its own __file__, which in a PyInstaller build is the bundle folder
REM  (_internal\). It is the product, not a user file, so nothing goes next to
REM  the exe except the readme. The cache stays in %%USERPROFILE%%\.stepview_cache.
REM
REM  Plain ASCII on purpose: cmd reads a .bat in the console code page, and no
REM  non-ASCII character survives every one of them.
REM ================================================================

REM Work from the repository root, whatever folder this was started from.
REM pushd, not cd /d: cmd cannot make a UNC path (\\server\share\...) its
REM current folder -- cd /d fails and leaves C:\Windows -- while pushd maps a
REM temporary drive letter for it. popd on the way out also gives a console
REM back the folder it started in, which setlocal does not.
pushd "%~dp0.."
if errorlevel 1 (
    echo [ERROR] Cannot open the repository folder. Copy it to a local drive.
    if not defined CI pause
    exit /b 1
)
set "ROOT=%CD%"

echo ================================================================
echo  QuickSTEP -- EXE build ^(PyInstaller, one folder^)
echo ================================================================
echo.

REM ---- Python -----------------------------------------------------------
python --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found on PATH.
    echo         Install 64-bit Python 3.9-3.13 from python.org, tick
    echo         "Add python.exe to PATH", then run this again.
    goto :fail
)
python -c "import struct,sys; sys.exit(0 if struct.calcsize('P')==8 and (3,9)<=sys.version_info[:2]<=(3,13) else 1)"
if errorlevel 1 (
    echo [ERROR] This Python cannot run the STEP engine:
    python -c "import struct,sys; print('        found Python %%d.%%d, %%d-bit' %% (sys.version_info[0], sys.version_info[1], struct.calcsize('P')*8))"
    echo         cascadio ships wheels for 64-bit Python 3.9-3.13 only.
    goto :fail
)

REM ---- 1. dependencies --------------------------------------------------
REM cascadio and numpy are the engine (numpy because cascadio 0.1.1 imports it
REM without declaring it -- see README.md); pyinstaller only builds the exe and
REM never ships in it. Behind a corporate proxy, set PIP_PROXY or follow the
REM offline-wheels steps in README.md first.
echo [1/5] Installing cascadio, numpy and PyInstaller...
python -m pip install --upgrade cascadio numpy pyinstaller
if errorlevel 1 (
    echo [ERROR] pip could not install the packages. See README.md for the
    echo         proxy and offline-wheels instructions.
    goto :fail
)
echo [1/5] Done.
echo.

REM ---- 2. preflight -----------------------------------------------------
REM Freeze only what is known good: viewer.html must be a faithful build of
REM src\ (a stale one would ship), and the engine must load in this Python.
echo [2/5] Checking viewer.html and the STEP engine...
python build.py --check
if errorlevel 1 (
    echo [ERROR] viewer.html is out of date. Run:  python build.py
    goto :fail
)
python stepview.py --check
if errorlevel 1 (
    echo [ERROR] The STEP engine does not load in this Python -- see above.
    goto :fail
)
echo [2/5] Done.
echo.

REM ---- 3. clean ---------------------------------------------------------
echo [3/5] Cleaning the previous build...
if exist "build\pyinstaller" rmdir /s /q "build\pyinstaller"
if exist "dist\QuickSTEP"    rmdir /s /q "dist\QuickSTEP"
if exist "dist\QuickSTEP" (
    echo [ERROR] Could not remove the old dist\QuickSTEP -- is QuickSTEP.exe
    echo         still running? Close it and run this again.
    goto :fail
)
REM The smoke test checks that it wrote this file, so none may be left over.
if exist "build\smoke_test.glb" del "build\smoke_test.glb"
echo [3/5] Done.
echo.

REM ---- 4. build ---------------------------------------------------------
REM --add-data takes an absolute source path: PyInstaller resolves a relative
REM one against --specpath, not the current folder. --collect-all cascadio
REM brings the OpenCASCADE DLLs, which import analysis cannot see.
echo [4/5] Building ^(1-3 minutes^)...
python -m PyInstaller --noconfirm --clean --onedir --console ^
  --name QuickSTEP ^
  --add-data "%ROOT%\viewer.html;." ^
  --collect-all cascadio ^
  --distpath "%ROOT%\dist" ^
  --workpath "%ROOT%\build\pyinstaller" ^
  --specpath "%ROOT%\build\pyinstaller" ^
  "%ROOT%\stepview.py"
if errorlevel 1 (
    echo [ERROR] PyInstaller failed -- see the output above.
    goto :fail
)
copy /y "scripts\QuickSTEP_README.txt" "dist\QuickSTEP\README.txt" > nul
if errorlevel 1 (
    echo [ERROR] scripts\QuickSTEP_README.txt not found.
    goto :fail
)
echo [4/5] Done.
echo.

REM ---- 5. smoke test ----------------------------------------------------
REM Prove the built exe, not this Python, can load the engine and convert a
REM real STEP file. A build that only "completed successfully" proves nothing.
echo [5/5] Testing the built exe...
"dist\QuickSTEP\QuickSTEP.exe" --check
if errorlevel 1 (
    echo [ERROR] The built exe cannot load the STEP engine.
    goto :fail
)
"dist\QuickSTEP\QuickSTEP.exe" "tests\browser\models\asm.step" --convert-only --force --out "build\smoke_test.glb"
if errorlevel 1 (
    echo [ERROR] The built exe could not convert a sample STEP file.
    goto :fail
)
if not exist "build\smoke_test.glb" (
    echo [ERROR] The built exe reported success but wrote no GLB.
    goto :fail
)
echo [5/5] Done.

echo.
echo ================================================================
echo  BUILD SUCCESSFUL
echo ================================================================
echo.
echo  Folder to distribute : dist\QuickSTEP\
echo  Program              : dist\QuickSTEP\QuickSTEP.exe
echo.
echo  Zip the WHOLE dist\QuickSTEP\ folder and give it to users. They need
echo  no Python. They unzip it anywhere and double-click QuickSTEP.exe, or
echo  drag a .step file onto it. The exe needs the _internal\ folder beside it.
echo.
echo  Windows SmartScreen may say "Windows protected your PC" because the exe
echo  is not code-signed: click "More info", then "Run anyway".
echo.
if not defined CI pause
popd
endlocal
exit /b 0

:fail
echo.
echo  BUILD FAILED
echo.
if not defined CI pause
popd
endlocal
exit /b 1
