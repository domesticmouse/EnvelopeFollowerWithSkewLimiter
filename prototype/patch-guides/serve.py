#!/usr/bin/env python3
"""Throwaway local HTTP server for Issue #10 Patch Guides UI prototype."""

from __future__ import annotations

import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class QuietHandler(SimpleHTTPRequestHandler):
    """Serve files from the repository root with clean UTF-8 MIME types."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Serve the ENV / SKEW Issue #10 Patch Guides UI prototype."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8766, help="Bind port (default: 8766)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    handler = functools.partial(QuietHandler, directory=str(repo_root))

    class ReusableThreadingHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    server = ReusableThreadingHTTPServer((args.host, args.port), handler)
    base_url = f"http://{args.host}:{args.port}/prototype/patch-guides/"
    print("ENV / SKEW — Issue #10 Patch Guides & Visualizer Prototype (Throwaway)")
    print(f"Serving repository root: {repo_root}")
    print(f"  Variant A (Studio Rack Workbench):       {base_url}?variant=A")
    print(f"  Variant B (Annotated Blueprint Hero):    {base_url}?variant=B")
    print(f"  Variant C (Interactive Dial-In Walk):    {base_url}?variant=C")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping prototype server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
