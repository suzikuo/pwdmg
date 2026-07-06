# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[("front/dist", "front/dist")],
    hiddenimports=["webview", "cryptography"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "android",
        "browser-extension",
        "front",
        "tests",
        "PIL",
        "IPython",
        "jupyter",
        "matplotlib",
        "numpy",
        "pandas",
        "pytest",
        "setuptools.tests",
        "tkinter",
    ],
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
    name="My Password",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="ico.ico",
)
