"""Local USB-to-web bridge for the PN532 test sketch.

Run: python local_bridge.py --serial COM3
Then open http://127.0.0.1:8317/ on this computer.
"""

import argparse
import json
import re
import socket
import sqlite3
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "local_data" / "library.sqlite3"
TAG_LINE = re.compile(r"Tag detected\. UID:\s*([0-9A-Fa-f:]+)")
UID_FORMAT = re.compile(r"(?:[0-9A-F]{2}:){3,9}[0-9A-F]{2}\Z")
last_scan = {"uid": None, "at": 0.0}
reader_state = {"port": None, "connected": False}
scan_lock = threading.Lock()


def database():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS cds (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tag_links (
                uid TEXT PRIMARY KEY,
                cd_id TEXT NOT NULL REFERENCES cds(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL,
                scanned_at TEXT NOT NULL
            );
        """)


def normalize_uid(value):
    uid = str(value).strip().upper()
    if not UID_FORMAT.fullmatch(uid):
        raise ValueError("UID must be 4 to 10 colon-separated hexadecimal bytes")
    return uid


def validate_cd(cd):
    if not isinstance(cd, dict):
        raise ValueError("CD must be an object")
    for key in ("id", "album", "artist"):
        if not isinstance(cd.get(key), str) or not cd[key].strip():
            raise ValueError(f"CD needs a {key}")
    if not isinstance(cd.get("tracks"), list):
        raise ValueError("CD needs a track list")
    return cd


def save_cd(cd, uid=None):
    cd = validate_cd(cd)
    if uid is not None:
        uid = normalize_uid(uid)
    with database() as connection:
        if uid:
            linked = connection.execute("SELECT cd_id FROM tag_links WHERE uid = ?", (uid,)).fetchone()
            if linked and linked["cd_id"] != cd["id"]:
                raise ValueError("This tag is already linked to another CD")
        connection.execute(
            "INSERT INTO cds (id, payload) VALUES (?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
            (cd["id"], json.dumps(cd)),
        )
        if uid:
            connection.execute(
                "INSERT OR IGNORE INTO tag_links (uid, cd_id) VALUES (?, ?)",
                (uid, cd["id"]),
            )
    return cd


def record_scan(value):
    uid = normalize_uid(value)
    now = time.monotonic()
    with scan_lock:
        if last_scan["uid"] == uid and now - last_scan["at"] < 3:
            return False
        last_scan.update(uid=uid, at=now)
        with database() as connection:
            connection.execute(
                "INSERT INTO scans (uid, scanned_at) VALUES (?, ?)",
                (uid, datetime.now(timezone.utc).isoformat()),
            )
    print(f"Scanned {uid}", flush=True)
    return True


def screen_result(uid):
    """Return the small album summary sent back over USB to the ESP32."""
    with database() as connection:
        row = connection.execute("""
            SELECT cds.payload FROM tag_links
            JOIN cds ON cds.id = tag_links.cd_id
            WHERE tag_links.uid = ?
        """, (uid,)).fetchone()
    if row is None:
        return {"uid": uid, "cd": None}
    cd = json.loads(row["payload"])
    return {"uid": uid, "cd": {
        "album": cd["album"][:100],
        "artist": cd["artist"][:100],
        "trackCount": len(cd["tracks"]),
    }}


def read_serial(port):
    reader_state["port"] = port
    try:
        import serial
    except ImportError:
        print("Install pyserial: python -m pip install pyserial", flush=True)
        return
    last_error = None
    while True:
        try:
            with serial.Serial(port, 115200, timeout=1) as device:
                reader_state["connected"] = True
                last_error = None
                print(f"Reading NFC scans from {port}", flush=True)
                while True:
                    line = device.readline().decode("utf-8", errors="replace")
                    match = TAG_LINE.search(line)
                    if match:
                        try:
                            uid = normalize_uid(match.group(1))
                            record_scan(uid)
                            reply = "NFC_RESULT " + json.dumps(
                                screen_result(uid), ensure_ascii=True, separators=(",", ":")
                            ) + "\n"
                            device.write(reply.encode("ascii"))
                        except ValueError:
                            pass
        except serial.SerialException as error:
            reader_state["connected"] = False
            if str(error) != last_error:
                print(f"Serial port unavailable: {error}. Retrying...", flush=True)
                last_error = str(error)
            time.sleep(3)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if self.path != "/api/scans/latest":
            super().log_message(format, *args)

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > 100_000:
            raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/library":
            with database() as connection:
                rows = connection.execute("SELECT payload FROM cds ORDER BY rowid DESC").fetchall()
            self.send_json(200, {"cds": [json.loads(row["payload"]) for row in rows]})
            return
        if path == "/api/scans/latest":
            with database() as connection:
                row = connection.execute("""
                    SELECT scans.id, scans.uid, scans.scanned_at, cds.payload
                    FROM scans LEFT JOIN tag_links ON tag_links.uid = scans.uid
                    LEFT JOIN cds ON cds.id = tag_links.cd_id
                    ORDER BY scans.id DESC LIMIT 1
                """).fetchone()
            self.send_json(200, {"reader": reader_state, "scan": None if row is None else {
                "id": row["id"], "uid": row["uid"], "scannedAt": row["scanned_at"],
                "cd": json.loads(row["payload"]) if row["payload"] else None,
            }})
            return
        names = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
        filename = names.get(path)
        if filename is None:
            self.send_error(404)
            return
        body = (ROOT / filename).read_bytes()
        content_type = "text/html" if filename.endswith("html") else "text/javascript" if filename.endswith("js") else "text/css"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            data = self.read_json()
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            path = urlparse(self.path).path
            if path == "/api/cds":
                self.send_json(200, {"cd": save_cd(data.get("cd"))})
            elif path == "/api/enroll":
                if not data.get("uid"):
                    raise ValueError("A scanned tag UID is required")
                self.send_json(200, {"cd": save_cd(data.get("cd"), data.get("uid"))})
            elif path == "/api/scans":
                # Local-only test endpoint; useful before a tag is available.
                record_scan(data.get("uid"))
                self.send_json(200, {"ok": True})
            else:
                self.send_error(404)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/cds/"):
            self.send_error(404)
            return
        cd_id = unquote(path[len("/api/cds/"):])
        with database() as connection:
            connection.execute("DELETE FROM cds WHERE id = ?", (cd_id,))
        self.send_json(200, {"ok": True})


class BridgeHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    global DB_PATH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", metavar="PORT", help="ESP32 serial port, for example COM3")
    parser.add_argument("--port", type=int, default=8317, help="Local website port (default: 8317)")
    parser.add_argument("--database", type=Path, default=DB_PATH, help="SQLite database path")
    args = parser.parse_args()
    DB_PATH = args.database.resolve()
    initialize_database()
    if args.serial:
        threading.Thread(target=read_serial, args=(args.serial,), daemon=True).start()
    server = BridgeHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Open http://127.0.0.1:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
