#!/usr/bin/env python3
"""Convenience wrapper: uv run python scripts/repl.py"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nepo_bot._repl import main  # noqa: E402

if __name__ == "__main__":
    asyncio.run(main())
