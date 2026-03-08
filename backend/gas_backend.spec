# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the gas-prediction backend (Prophet-only, no torch/sklearn).

Build:
    cd backend && uv run --extra pack pyinstaller gas_backend.spec \
        --distpath ../backend-dist \
        --workpath ../build/pyinstaller \
        --noconfirm
"""

import importlib.metadata as _meta
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, copy_metadata

# ---------------------------------------------------------------------------
# Prophet + cmdstanpy: collect everything (data, binaries, hidden imports)
# ---------------------------------------------------------------------------
prophet_datas, prophet_binaries, prophet_hiddenimports = collect_all('prophet')
cmdstanpy_datas, cmdstanpy_binaries, cmdstanpy_hiddenimports = collect_all('cmdstanpy')

# Only copy metadata for packages that are actually installed — CI and local
# environments may have different transitive dependency sets.
_META_CANDIDATES = [
    'prophet', 'cmdstanpy', 'tqdm', 'packaging', 'filelock',
    'numpy', 'pandas', 'regex', 'requests',
]
metadata_datas = []
for _pkg in _META_CANDIDATES:
    try:
        _meta.distribution(_pkg)
        metadata_datas += copy_metadata(_pkg)
    except _meta.PackageNotFoundError:
        pass

all_datas = prophet_datas + cmdstanpy_datas + metadata_datas
all_binaries = prophet_binaries + cmdstanpy_binaries

# ---------------------------------------------------------------------------
# Hidden imports
# ---------------------------------------------------------------------------
hidden_imports = [
    # uvicorn internals
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    # fastapi / starlette
    'fastapi',
    'fastapi.middleware',
    'fastapi.middleware.cors',
    'fastapi.responses',
    'starlette.routing',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.responses',
    'starlette.staticfiles',
    'starlette.datastructures',
    # python-multipart
    'multipart',
    # prophet / stan
    'prophet',
    'prophet.forecaster',
    'cmdstanpy',
    # pandas / numpy extras
    'pandas._libs.tslibs.timedeltas',
    'pandas._libs.tslibs.np_datetime',
    'pandas._libs.tslibs.nattype',
    'pandas._libs.tslibs.offsets',
    'pandas._libs.skiplist',
] + cmdstanpy_hiddenimports + prophet_hiddenimports

# ---------------------------------------------------------------------------
# Analysis — entry point is run_server.py (starts uvicorn programmatically)
# ---------------------------------------------------------------------------
a = Analysis(
    ['run_server.py'],
    pathex=[str(Path('.').resolve())],
    binaries=all_binaries,
    datas=all_datas + [
        ('main.py', '.'),
        ('trainer.py', '.'),
    ],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'IPython',
        'jupyter',
        'notebook',
        'pytest',
        'setuptools',
        'torch',
        'torchvision',
        'torchaudio',
        'sklearn',
        'scikit-learn',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='gas_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='gas_backend',
)
