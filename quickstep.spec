# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for QuickSTEP — builds one self-contained executable.

    pip install pyinstaller cascadio numpy
    pyinstaller quickstep.spec

Everything the tool needs goes inside the single file: the Python runtime,
viewer.html, and the cascadio tessellation engine with its OpenCASCADE
libraries. The person running it needs no Python and no CAD install.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = collect_all("cascadio")

# The OpenCASCADE shared libraries do not live inside the cascadio package:
# the wheel builders (delvewheel on Windows, auditwheel on Linux) put them in a
# sibling folder — "cascadio.libs" / "cascadio." — that cascadio finds relative
# to its own __file__. Keep that folder name so the lookup still works frozen.
import cascadio  # noqa: E402

_pkg = Path(cascadio.__file__).parent
for sibling in _pkg.parent.glob("cascadio*"):
    if not sibling.is_dir() or sibling == _pkg or sibling.name.endswith(".dist-info"):
        continue
    for lib in sibling.iterdir():
        if lib.is_file():
            binaries.append((str(lib), sibling.name))

datas.append(("viewer.html", "."))

a = Analysis(
    ["stepview.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Nothing here is imported by the viewer; dropping them keeps the download
    # a lot smaller than the OpenCASCADE payload already forces it to be.
    excludes=["tkinter", "matplotlib", "scipy", "PIL", "pytest", "IPython", "trimesh"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="QuickSTEP",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,          # the conversion progress and errors are printed here
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
