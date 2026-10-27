#!/usr/bin/env python3
"""Local http server for CyberSpace77 (mirrors .htaccess)."""

import argparse
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFIX = ""  # e.g. "/dir" when the app is served from a subdirectory

# Same preview fetchers as .htaccess. Search crawlers stay on index.html.
CRAWLER_UA = re.compile(
    r"facebookexternalhit|Twitterbot|TelegramBot|WhatsApp|Discordbot|"
    r"Slackbot|Slack-ImgProxy|LinkedInBot|Pinterest|redditbot|Embedly|Iframely|"
    r"vkShare|MicrosoftPreview|BingPreview|Viber|Tumblr|"
    r"Snapchat|Mastodon|Akkoma|Pleroma|Misskey|Bluesky|bitlybot|"
    r"kakaotalk-scrap|FlipboardProxy|GoogleMessages|"
    r"Quora Link Preview|Yahoo Link Preview|outbrain|rogerbot",
    re.IGNORECASE,
)


def strip_prefix(raw_path):
    path = raw_path or "/"
    if not PREFIX:
        return path
    if path == PREFIX or path == PREFIX + "/":
        return "/"
    if path.startswith(PREFIX + "/"):
        return path[len(PREFIX) :] or "/"
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def is_crawler(self):
        return bool(CRAWLER_UA.search(self.headers.get("User-Agent") or ""))

    def serve_crawler(self, path, query):
        php = shutil.which("php")
        script = ROOT / "crawler.php"
        if not php or not script.is_file():
            return False
        env = os.environ.copy()
        env["REQUEST_URI"] = path + (("?" + query) if query else "")
        env["HTTP_HOST"] = self.headers.get("Host") or "127.0.0.1"
        env["HTTP_USER_AGENT"] = self.headers.get("User-Agent") or ""
        forwarded = self.headers.get("X-Forwarded-Proto") or ""
        if forwarded:
            env["HTTP_X_FORWARDED_PROTO"] = forwarded
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            env["HTTPS"] = "on"
        try:
            proc = subprocess.run(
                [php, str(script)],
                capture_output=True,
                env=env,
                cwd=str(ROOT),
                timeout=12,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        if proc.returncode != 0 or not proc.stdout:
            return False
        body = proc.stdout
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Vary", "User-Agent")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw = urllib.parse.unquote(parsed.path)
        stripped = strip_prefix(raw)
        if stripped is None:
            self.send_error(404)
            return
        rel = stripped.lstrip("/")
        qs = parsed.query
        if rel:
            target = (ROOT / rel).resolve()
            try:
                target.relative_to(ROOT)
            except ValueError:
                self.send_error(403)
                return
            if target.is_file():
                self.path = "/" + rel + (("?" + qs) if qs else "")
                return super().do_GET()
        if self.is_crawler() and self.serve_crawler(stripped or "/", qs):
            return
        self.path = "/index.html" + (("?" + qs) if qs else "")
        return super().do_GET()

    def log_message(self, fmt, *args):
        try:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
            sys.stderr.flush()
        except OSError:
            pass


class Server(ThreadingHTTPServer):
    allow_reuse_address = False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CyberSpace77 local server")
    parser.add_argument("--port", type=int, default=8777)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--prefix",
        default="/",
        help="URL prefix when serving from a subdirectory, e.g. /dir",
    )
    args = parser.parse_args()
    prefix = (args.prefix or "/").strip() or "/"
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    PREFIX = "" if prefix == "/" else prefix.rstrip("/")
    try:
        httpd = Server((args.host, args.port), Handler)
    except OSError as exc:
        print(f"Could not bind http://{args.host}:{args.port}/ — {exc}", file=sys.stderr)
        print("Stop the old python process using that port, or pick another: python server.py --port 8778", file=sys.stderr)
        sys.exit(1)
    root_url = f"http://{args.host}:{args.port}{PREFIX}/"
    print(f"CyberSpace77  {root_url}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
        httpd.server_close()
