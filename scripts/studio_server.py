#!/usr/bin/env python3
"""Serve the Studio and its local reconstruction queue on a private machine."""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
MIB = 1024 * 1024
PHOTOS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEOS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
PUBLIC = {"index.html", "studio.js", "studio.css", "viewer.html", "app.js", "styles.css",
          "scan.html", "software-renderer.js", "texture-projection.js"}
JOB_URL = re.compile(r"/api/jobs/([0-9a-f]{32})(?:/(start|result.glb|log|files/(\d+)))?")


class RequestProblem(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def write_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False))
    os.replace(temp, path)


def natural_key(name):
    return [(0, int(piece)) if piece.isdigit() else (1, piece.casefold())
            for piece in re.split(r"(\d+)", name)]


class Studio:
    def __init__(self, data, openmvs, gltfpack, threads, resolution, timeout):
        self.data = data
        self.command = [
            sys.executable, str(ROOT / "scripts" / "run_scan.py"),
            "--openmvs", str(openmvs), "--gltfpack", gltfpack,
            "--threads", str(threads), "--resolution", str(resolution),
        ]
        self.timeout = timeout
        self.lock = threading.RLock()
        self.uploads = set()
        self.active = None
        self.data.mkdir(parents=True, exist_ok=True)
        for path in self.data.glob("*/job.json"):
            with path.open() as saved:
                job = json.load(saved)
            if job["state"] == "running":
                job["state"] = "failed"
                write_json(path, job)
                write_json(path.parent / "report.json", {"stage": "failed", "metrics": {},
                           "message": "The worker restarted during reconstruction. Create a new scan to retry."})

    def create(self, payload):
        if not isinstance(payload, dict):
            raise RequestProblem(400, "Invalid capture description.")
        kind, items = payload.get("kind"), payload.get("files")
        if kind not in ("photos", "video") or not isinstance(items, list):
            raise RequestProblem(400, "Choose a video or a set of photos.")
        count = len(items)
        if (kind == "video" and count != 1) or (kind == "photos" and not 12 <= count <= 180):
            raise RequestProblem(400, "Select one video or 12–180 photos.")
        allowed = VIDEOS if kind == "video" else PHOTOS
        limit = 1024 * MIB if kind == "video" else 30 * MIB
        records = []
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                raise RequestProblem(400, "A selected file has an invalid name.")
            display = Path(item["name"].replace("\\", "/")).name[:250]
            extension = Path(display).suffix.lower()
            size = item.get("size")
            if extension not in allowed or type(size) is not int or not 0 < size <= limit:
                raise RequestProblem(400, "A file type or size is outside the capture limits.")
            records.append({"name": display, "size": size, "extension": extension})
        if sum(item["size"] for item in records) > (1024 if kind == "video" else 500) * MIB:
            raise RequestProblem(413, "The capture exceeds the total upload limit.")
        # Keep upload indices in the browser's selection order, then sort photos for reconstruction.
        for i, item in enumerate(records):
            item["slot"] = i
            item["key"] = f"{i:04}" + item.pop("extension")
        if kind == "photos":
            records.sort(key=lambda item: natural_key(item["name"]))
        name = payload.get("name")
        if not isinstance(name, str):
            name = ""
        name = " ".join(name.split())[:90] or "Untitled scan"
        uid = uuid.uuid4().hex
        directory = self.data / uid
        (directory / "inputs").mkdir(parents=True)
        spec = {"id": uid, "name": name, "kind": kind, "files": records, "state": "waiting"}
        write_json(directory / "job.json", spec)
        return self.get(uid)

    def read(self, uid):
        directory = self.data / uid
        try:
            return directory, json.loads((directory / "job.json").read_text())
        except FileNotFoundError:
            raise RequestProblem(404, "Scan job not found.") from None

    def get(self, uid):
        directory, spec = self.read(uid)
        report = directory / "report.json"
        details = json.loads(report.read_text()) if report.is_file() else {}
        return {
            "id": uid, "name": spec["name"], "kind": spec["kind"], "state": spec["state"],
            "received": sum((directory / "inputs" / item["key"]).is_file() for item in spec["files"]),
            "files": len(spec["files"]), "stage": details.get("stage", spec["state"]),
            "metrics": details.get("metrics", {}), "message": details.get("message"),
        }

    def list(self):
        jobs = sorted(self.data.glob("*/job.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        return [self.get(path.parent.name) for path in jobs[:40]]

    def upload(self, uid, index, stream, length):
        with self.lock:
            directory, spec = self.read(uid)
            item = next((item for item in spec["files"] if item["slot"] == index), None)
            if spec["state"] != "waiting" or (uid, index) in self.uploads:
                raise RequestProblem(409, "This scan is already processing or receiving that file.")
            if item is None or length != item["size"]:
                raise RequestProblem(400, "The uploaded file differs from the selected capture.")
            self.uploads.add((uid, index))
        target = directory / "inputs" / item["key"]
        temporary = target.with_suffix(".upload")
        try:
            remaining = length
            with temporary.open("wb") as handle:
                while remaining:
                    content = stream.read(min(1024 * 1024, remaining))
                    if not content:
                        raise RequestProblem(400, "The upload ended early. Select the file again.")
                    handle.write(content)
                    remaining -= len(content)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
            with self.lock:
                self.uploads.discard((uid, index))
        return self.get(uid)

    def start(self, uid):
        with self.lock:
            directory, spec = self.read(uid)
            if self.active is not None:
                raise RequestProblem(409, "One scan is already running. Wait for it to finish.")
            if spec["state"] != "waiting" or any(job == uid for job, _ in self.uploads):
                raise RequestProblem(409, "This job cannot be started yet.")
            if any(not (directory / "inputs" / item["key"]).is_file() for item in spec["files"]):
                raise RequestProblem(409, "Upload all selected files before starting.")
            spec["state"] = "running"
            write_json(directory / "job.json", spec)
            self.active = uid
            threading.Thread(target=self.process, args=(directory, spec), daemon=True).start()
        return self.get(uid)

    def process(self, directory, spec):
        state = "failed"
        try:
            with (directory / "process.log").open("w") as log:
                worker = subprocess.Popen(self.command + [str(directory)], stdout=log,
                                          stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    code = worker.wait(timeout=self.timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(worker.pid, signal.SIGKILL)
                    worker.wait()
                    raise
            if code == 0 and (directory / "result.glb").is_file():
                state = "complete"
            elif code == 2:
                state = "rejected"
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"Worker {spec['id']} stopped: {error}", file=sys.stderr)
        finally:
            if state == "failed":
                report = directory / "report.json"
                saved = json.loads(report.read_text()) if report.is_file() else {}
                write_json(report, {"stage": "failed", "metrics": saved.get("metrics", {}),
                                    "message": saved.get("message") or "The worker stopped. Open the job log for details."})
            with self.lock:
                spec["state"] = state
                write_json(directory / "job.json", spec)
                self.active = None
            shutil.rmtree(directory / "work", ignore_errors=True)


class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    @property
    def studio(self):
        return self.server.studio

    def matches_origin(self):
        return (self.headers.get("Host") in self.server.hosts
                and self.headers.get("Origin", "http://" + self.headers.get("Host", "")) in self.server.origins
                and self.headers.get("Sec-Fetch-Site") != "cross-site")

    def send_json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode(), "application/json", status)

    def send_bytes(self, content, mime, status=200):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def read_size(self):
        try:
            length = int(self.headers["Content-Length"])
            if length <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise RequestProblem(411, "A content length is required.") from None
        return length

    def route_api(self, path, query):
        if not self.matches_origin():
            raise RequestProblem(403, "Open the Studio directly on localhost.")
        if path == "/api/health" and self.command == "GET":
            return self.send_json({"service": "vyral-studio", "version": 1})
        if path == "/api/jobs":
            if self.command == "GET":
                return self.send_json(self.studio.list())
            if self.command == "POST":
                length = self.read_size()
                if length > 64 * 1024:
                    raise RequestProblem(413, "The capture description is too large.")
                return self.send_json(self.studio.create(json.loads(self.rfile.read(length))), 201)
        match = JOB_URL.fullmatch(path)
        if match:
            uid, action, index = match.groups()
            if self.command == "GET" and action is None:
                return self.send_json(self.studio.get(uid))
            if self.command == "PUT" and index is not None:
                return self.send_json(self.studio.upload(uid, int(index), self.rfile, self.read_size()))
            if self.command == "POST" and action == "start":
                return self.send_json(self.studio.start(uid), 202)
            if self.command == "GET" and action in ("result.glb", "log"):
                directory, spec = self.studio.read(uid)
                if action == "log":
                    log = directory / "process.log"
                    if log.is_file():
                        with log.open("rb") as handle:
                            handle.seek(max(0, log.stat().st_size - 24000))
                            return self.send_bytes(handle.read(), "text/plain; charset=utf-8")
                elif spec["state"] == "complete":
                    result = directory / action
                    if result.is_file():
                        self.send_response(200)
                        self.send_header("Content-Type", "model/gltf-binary")
                        self.send_header("Content-Length", str(result.stat().st_size))
                        self.send_header("Cache-Control", "no-store")
                        if parse_qs(query).get("download") == ["1"]:
                            self.send_header("Content-Disposition", "attachment; filename=vyral-tour.glb")
                        self.end_headers()
                        with result.open("rb") as handle:
                            shutil.copyfileobj(handle, self.wfile)
                        return
        raise RequestProblem(404, "That Studio endpoint is unavailable.")

    def route(self):
        parsed = urlsplit(self.path)
        try:
            if parsed.path.startswith("/api/"):
                return self.route_api(parsed.path, parsed.query)
            if self.command in ("GET", "HEAD"):
                relative = parsed.path.lstrip("/")
                if relative in PUBLIC or relative == "" or re.fullmatch(r"assets/scans/[a-z0-9.-]+", relative):
                    return super().do_HEAD() if self.command == "HEAD" else super().do_GET()
            raise RequestProblem(404, "Page not found.")
        except RequestProblem as error:
            self.close_connection = True
            return self.send_json({"error": str(error)}, error.status)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self.send_json({"error": "Malformed capture description."}, HTTPStatus.BAD_REQUEST)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    do_GET = do_HEAD = do_POST = do_PUT = route


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--data", type=Path, default=Path(".studio-data"))
    parser.add_argument("--openmvs", type=Path, required=True)
    parser.add_argument("--gltfpack", default="gltfpack")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--resolution", type=int, default=960)
    parser.add_argument("--timeout", type=int, default=10800)
    args = parser.parse_args()
    for name in ("InterfaceCOLMAP", "DensifyPointCloud", "ReconstructMesh"):
        if not (args.openmvs / name).is_file():
            parser.error(f"{name} is missing from the OpenMVS directory")
    for tool in ("ffmpeg", "ffprobe", args.gltfpack):
        if not shutil.which(tool):
            parser.error(f"{tool} is missing or not executable")
    server = ThreadingHTTPServer((args.host, args.port), StudioHandler)
    listen_port = server.server_address[1]
    server.hosts = {f"{host}:{listen_port}" for host in ("127.0.0.1", "localhost")}
    server.origins = {"http://" + host for host in server.hosts}
    server.studio = Studio(args.data.resolve(), args.openmvs.resolve(), args.gltfpack,
                           max(1, args.threads), args.resolution, args.timeout)
    print(f"Vyral Studio is ready at http://127.0.0.1:{listen_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
