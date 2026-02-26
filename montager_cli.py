#!/usr/bin/env python3
"""
Montager CLI - Command-line interface for video montage generation.

Usage:
    python montager_cli.py /detect-scene [video]
    python montager_cli.py /detect-voicemap [video]
    python montager_cli.py /preview [video]
    python montager_cli.py /render [video]
"""

import sys
from pathlib import Path

from montager import (
    find_video_file,
    detect_scene,
    detect_voicemap,
    generate_preview,
    render_montage,
)


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        print("Commands:")
        print("  /detect-scene [video]    - Detect faces and generate scene.json")
        print("  /detect-voicemap [video] - Detect speech segments and map to speakers")
        print("  /preview [video]         - Generate HTML preview")
        print("  /render [video]          - Render final montage video")
        return 0
    
    command = sys.argv[1].lower()
    video_arg = sys.argv[2] if len(sys.argv) > 2 else None
    video_path = find_video_file(video_arg)
    
    try:
        if command == '/detect-scene':
            detect_scene(video_path)
        elif command == '/detect-voicemap':
            detect_voicemap(video_path)
        elif command == '/preview':
            generate_preview(video_path)
        elif command == '/render':
            render_montage(video_path)
        else:
            print(f"Unknown command: {command}")
            return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
