#!/usr/bin/env python3
"""Serve the dashboard directory over HTTP for local development."""

from __future__ import annotations

import argparse
import http.server
import socketserver
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve XAUlytics dashboard static files.")
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=8080,
        help="TCP port (default: 8080)",
    )
    parser.add_argument(
        "--bind",
        "-b",
        default="127.0.0.1",
        help="Bind address (default: 127.0.0.1)",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, fmt: str, *log_args) -> None:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % log_args))

    try:
        with socketserver.TCPServer((args.bind, args.port), Handler) as httpd:
            url = f"http://{args.bind}:{args.port}/index.html"
            print(f"Serving {root}", file=sys.stderr)
            print(f"Open {url}", file=sys.stderr)
            httpd.serve_forever()
    except OSError as e:
        print(f"Could not bind {args.bind}:{args.port}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
