#!/usr/bin/env python3
"""Local http server for CyberSpace77 (mirrors .htaccess)."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFIX = ""  # e.g. "/dir" when the app is served from a subdirectory

# Same preview fetchers as .htaccess. Search crawlers stay on index.html.
# Hive has no index of who delegated resource credits to an account.
# PeakD's public list does, but it rejects browser requests that send Origin.
HIVE_NAME = re.compile(r"^[a-z][a-z0-9.\-]{1,14}[a-z0-9]$")
RC_INCOMING_LIMIT = 2 * 1024 * 1024
RC_INCOMING_PATHS = (
    "/api/rc-delegations-incoming",
    "/api/rc-delegations-incoming.php",
)

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

    def send_json(self, status, body):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def proxy_rc_incoming(self, query):
        params = urllib.parse.parse_qs(query or "", keep_blank_values=False)
        raw = ((params.get("delegatee") or [""])[0] or "").strip().lower()
        if raw.startswith("@"):
            raw = raw[1:]
        if not HIVE_NAME.match(raw):
            self.send_json(400, '{"error":"Enter a hive username."}')
            return
        url = (
            "https://peakd.com/api/public/rc_delegations/incoming?delegatee="
            + urllib.parse.quote(raw)
        )
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CyberSpace77", "Accept": "application/json"},
            method="GET",
        )
        data = b""
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                status = getattr(res, "status", 0) or res.getcode()
                data = res.read(RC_INCOMING_LIMIT + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            status = 502
            data = b""
        if (
            status != 200
            or not data
            or len(data) > RC_INCOMING_LIMIT
            or data[:1] not in (b"[", b"{")
        ):
            self.send_json(502, '{"error":"Incoming resource credits could not be loaded."}')
            return
        try:
            parsed = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(502, '{"error":"Incoming resource credits could not be loaded."}')
            return
        if not isinstance(parsed, list):
            self.send_json(502, '{"error":"Incoming resource credits could not be loaded."}')
            return
        self.send_json(200, data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw = urllib.parse.unquote(parsed.path)
        stripped = strip_prefix(raw)
        if stripped is None:
            self.send_error(404)
            return
        if stripped in RC_INCOMING_PATHS:
            self.proxy_rc_incoming(parsed.query)
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
