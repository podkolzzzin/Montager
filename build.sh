#!/bin/bash
# Build script for Montager executables
# Creates: mcli (CLI), montager (GUI) for Linux
# Creates: mcli.exe, montager.exe for Windows (when run on Windows or cross-compile)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure we're in venv
if [ -z "$VIRTUAL_ENV" ]; then
    if [ -d "venv" ]; then
        source venv/bin/activate
    else
        echo "Creating virtual environment..."
        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
    fi
fi

# Install pyinstaller if needed
pip install pyinstaller --quiet

# Clean previous builds
rm -rf build dist

# Detect platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    EXT=".exe"
    PLATFORM="windows"
else
    EXT=""
    PLATFORM="linux"
fi

echo "Building for $PLATFORM..."

# Common PyInstaller options
COMMON_OPTS="--noconfirm --clean"

# Data files to include
DATA_OPTS="--add-data blaze_face_short_range.tflite:."
DATA_OPTS="$DATA_OPTS --add-data montager:montager"

# Hidden imports needed by the app
HIDDEN="--hidden-import=sklearn.cluster"
HIDDEN="$HIDDEN --hidden-import=sklearn.utils._cython_blas"
HIDDEN="$HIDDEN --hidden-import=scipy.special._cdflib"
HIDDEN="$HIDDEN --hidden-import=soundfile"

echo ""
echo "=== Building CLI (mcli) ==="
pyinstaller $COMMON_OPTS $DATA_OPTS $HIDDEN \
    --name "mcli" \
    --console \
    --onefile \
    montager_cli.py

echo ""
echo "=== Building GUI (montager) ==="
pyinstaller $COMMON_OPTS $DATA_OPTS $HIDDEN \
    --hidden-import=PyQt5.sip \
    --name "montager" \
    --windowed \
    --onefile \
    montager_gui.py

echo ""
echo "=== Build complete ==="
echo "Outputs in dist/:"
ls -la dist/

# Create dist archive
ARCHIVE="montager-$PLATFORM.tar.gz"
if [[ "$PLATFORM" == "windows" ]]; then
    ARCHIVE="montager-windows.zip"
    cd dist && zip -r "../$ARCHIVE" . && cd ..
else
    tar -czvf "$ARCHIVE" -C dist .
fi

echo ""
echo "Archive created: $ARCHIVE"
