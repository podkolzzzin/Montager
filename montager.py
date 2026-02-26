#!/usr/bin/env python3
"""
Montager - Backward compatible entry point.
Delegates to montager_cli.py or can be used as a library.
"""

# Re-export everything from the package for library usage
from montager import *

# CLI entry point
if __name__ == '__main__':
    from montager_cli import main
    import sys
    sys.exit(main())
