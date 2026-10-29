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
CRAWLER_UA = re.compile(
    r"facebookexternalhit|Twitterbot|TelegramBot|WhatsApp|Discordbot|"
    r"Slackbot|Slack-ImgProxy|LinkedInBot|Pinterest|redditbot|Embedly|Iframely|"
    r"vkShare|MicrosoftPreview|BingPreview|Viber|Tumblr|"
    r"Snapchat|Mastodon|Akkoma|Pleroma|Misskey|Bluesky|bitlybot|"
    r"kakaotalk-scrap|FlipboardProxy|GoogleMessages|"
    r"Quora Link Preview|Yahoo Link Preview|outbrain|rogerbot",
    re.IGNORECASE,
)


RUMBLE_WATCH = re.compile(
    r"^/v[0-9a-z]{4,16}(?:-[^/?#]+)?(?:\.html)?$",
    re.IGNORECASE,
)
RUMBLE_EMBED_SRC = re.compile(
    r"https://rumble\.com/embed/([a-z0-9]{4,20}(?:\.[a-z0-9]{4,20})?)",
    re.IGNORECASE,
)


def rumble_embed_src(raw):
    """Page id and embed id differ on Rumble. Ask oEmbed, return the player URL."""
    if not isinstance(raw, str):
        return ""
    raw = raw.strip()
    if not raw or len(raw) > 500:
        return ""
    parts = urllib.parse.urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        return ""
    host = (parts.hostname or "").lower().rstrip(".")
    if host not in ("rumble.com", "www.rumble.com"):
        return ""
    path = parts.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    if ".." in path or re.search(r'[<>"\'\\\s]', path):
        return ""
    if re.match(r"^/videos(?:[./-]|$)", path, re.IGNORECASE):
        return ""
    if not RUMBLE_WATCH.match(path):
        return ""
    watch = "https://rumble.com" + path
    endpoint = "https://rumble.com/api/Media/oembed.json?url=" + urllib.parse.quote(watch, safe="")
    req = urllib.request.Request(endpoint, headers={"User-Agent": "CyberSpace77"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if getattr(resp, "status", 200) != 200:
                return ""
            payload = resp.read(200000)
    except (OSError, ValueError):
        return ""
    try:
        data = json.loads(payload.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return ""
    html = data.get("html") if isinstance(data, dict) else ""
    if not isinstance(html, str):
        return ""
    match = RUMBLE_EMBED_SRC.search(html)
    if not match:
        return ""
    return "https://rumble.com/embed/" + match.group(1).lower() + "/"


TIKTOK_HOSTS = {
    "vm.tiktok.com",
    "vt.tiktok.com",
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
}
TIKTOK_VIDEO = re.compile(r"/video/([0-9]{8,22})(?:[/?#]|$)")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _tiktok_parts(raw):
    parts = urllib.parse.urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if host not in TIKTOK_HOSTS:
        return None
    path = parts.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    if not path or ".." in path or re.search(r'[<>"\'\\\s]', path):
        return None
    return host, path


def tiktok_short_url(raw):
    """Only vm/vt and /t/ links. Those redirects carry the video id."""
    if not isinstance(raw, str):
        return ""
    raw = raw.strip()
    if not raw or len(raw) > 500:
        return ""
    parsed = _tiktok_parts(raw)
    if not parsed:
        return ""
    host, path = parsed
    if host in ("vm.tiktok.com", "vt.tiktok.com"):
        if not re.fullmatch(r"/[A-Za-z0-9_-]{4,32}", path):
            return ""
    elif host in ("tiktok.com", "www.tiktok.com", "m.tiktok.com"):
        if not re.fullmatch(r"/t/[A-Za-z0-9_-]{4,32}", path):
            return ""
        if host == "m.tiktok.com":
            host = "www.tiktok.com"
    else:
        return ""
    return "https://" + host + path


def _tiktok_id(url):
    parsed = _tiktok_parts(url)
    if not parsed:
        return ""
    match = TIKTOK_VIDEO.search(parsed[1])
    return match.group(1) if match else ""


def tiktok_player_src(raw):
    current = tiktok_short_url(raw)
    if not current:
        return ""
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(4):
        req = urllib.request.Request(
            current,
            method="HEAD",
            headers={"User-Agent": "CyberSpace77"},
        )
        try:
            with opener.open(req, timeout=8) as resp:
                return ""
        except urllib.error.HTTPError as err:
            if err.code not in (301, 302, 303, 307, 308):
                return ""
            loc = err.headers.get("Location") or ""
            nxt = urllib.parse.urljoin(current, loc)
            video_id = _tiktok_id(nxt)
            if video_id:
                return "https://www.tiktok.com/player/v1/" + video_id
            if not _tiktok_parts(nxt):
                return ""
            host, path = _tiktok_parts(nxt)
            current = "https://" + host + path
        except (OSError, ValueError):
            return ""
    return ""


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

    def serve_rumble_embed(self, query):
        params = urllib.parse.parse_qs(query or "", keep_blank_values=False)
        raw = (params.get("url") or [""])[0]
        src = rumble_embed_src(raw)
        if src:
            body = json.dumps({"src": src}).encode("utf-8")
            status = 200
            cache = "public, max-age=86400"
        else:
            body = b'{"src":""}'
            status = 404
            cache = "no-store"
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_tiktok_embed(self, query):
        params = urllib.parse.parse_qs(query or "", keep_blank_values=False)
        raw = (params.get("url") or [""])[0]
        src = tiktok_player_src(raw)
        if src:
            body = json.dumps({"src": src}).encode("utf-8")
            status = 200
            cache = "public, max-age=86400"
        else:
            body = b'{"src":""}'
            status = 404
            cache = "no-store"
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw = urllib.parse.unquote(parsed.path)
        stripped = strip_prefix(raw)
        if stripped is None:
            self.send_error(404)
            return
        rel = stripped.lstrip("/")
        qs = parsed.query
        if rel == "rumble-embed.php":
            self.serve_rumble_embed(qs)
            return
        if rel == "tiktok-embed.php":
            self.serve_tiktok_embed(qs)
            return
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
