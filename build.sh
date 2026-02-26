#!/bin/bash
# Build script for Montager executables
# Creates 4 artifacts: cli and gui for current platform

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Detect platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    EXT=".exe"
    PLATFORM="win"
    SEP=";"
else
    EXT=""
    PLATFORM="nix"
    SEP=":"
fi

echo "Building for $PLATFORM..."

# Clean previous builds
rm -rf build dist

# Common PyInstaller options
COMMON="--noconfirm --clean --onefile"
COMMON="$COMMON --add-data blaze_face_short_range.tflite${SEP}."
COMMON="$COMMON --add-data montager${SEP}montager"

# Exclude heavy unused modules to reduce size
EXCLUDES="--exclude-module matplotlib"
EXCLUDES="$EXCLUDES --exclude-module PIL"
EXCLUDES="$EXCLUDES --exclude-module tkinter"
EXCLUDES="$EXCLUDES --exclude-module unittest"
EXCLUDES="$EXCLUDES --exclude-module pydoc"
EXCLUDES="$EXCLUDES --exclude-module difflib"
EXCLUDES="$EXCLUDES --exclude-module pyannote"

# Hidden imports
HIDDEN="--hidden-import=sklearn.cluster"
HIDDEN="$HIDDEN --hidden-import=sklearn.utils._cython_blas"
HIDDEN="$HIDDEN --hidden-import=soundfile"

echo ""
echo "=== Building CLI (${PLATFORM}_cli) ==="
pyinstaller $COMMON $EXCLUDES $HIDDEN \
    --name "${PLATFORM}_cli" \
    --console \
    montager_cli.py

echo ""
echo "=== Building GUI (${PLATFORM}_ui) ==="
pyinstaller $COMMON $EXCLUDES $HIDDEN \
    --hidden-import=PyQt5.sip \
    --hidden-import=PyQt5.QtCore \
    --hidden-import=PyQt5.QtWidgets \
    --hidden-import=PyQt5.QtGui \
    --name "${PLATFORM}_ui" \
    --windowed \
    montager_gui.py

echo ""
echo "=== Build complete ==="
ls -lh dist/

# Create zip
cd dist
if [[ "$PLATFORM" == "win" ]]; then
    zip -9 "../montager-${PLATFORM}.zip" *
else
    zip -9 "../montager-${PLATFORM}.zip" *
fi
cd ..

echo ""
echo "Archive: montager-${PLATFORM}.zip"
ls -lh montager-${PLATFORM}.zip
