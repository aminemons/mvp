#!/usr/bin/env python3
"""Build a portable Vyral walkthrough from a local video or photo set."""

import argparse
import json
import math
import os
import struct
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pycolmap
import trimesh
from PIL import Image, ImageOps
from trimesh.ray.ray_pyembree import RayMeshIntersector

from build_mesh import build_surface, track
from package_scan import create_metadata, read_camera_track
from project_atlas import bake_atlas, pick_views

MAX_FRAMES = 180
MIN_FRAMES = 12
MIN_REGISTRATION = 0.65
MIN_COVERAGE = 0.78


class CaptureError(ValueError):
    """A deficiency in the capture that the operator can address."""


def write_report(path, stage, metrics, message=None):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"stage": stage, "metrics": metrics, "message": message}))
    os.replace(temporary, path)


def prepare_frames(job, frames, threads):
    spec = job_spec(job)
    paths = [job / "inputs" / entry["key"] for entry in spec["files"]]
    if spec["kind"] == "video":
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:format=duration", "-of", "json", str(paths[0])],
            text=True, capture_output=True,
        )
        try:
            metadata = json.loads(probe.stdout)
            duration = float(metadata["format"]["duration"])
            if probe.returncode or not math.isfinite(duration) or duration < 4 or not metadata["streams"]:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise CaptureError("Use a readable phone video at least four seconds long.") from None
        fps = min(3, MAX_FRAMES / duration)
        scale = "scale=w='min(1440,iw)':h='min(1440,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
        decoding = subprocess.run(
            ["ffmpeg", "-v", "error", "-nostdin", "-threads", str(threads), "-i", str(paths[0]),
             "-map", "0:v:0", "-an", "-vf", f"fps={fps},{scale}", "-frames:v", str(MAX_FRAMES),
             "-threads", "2", "-q:v", "2", str(frames / "%04d.jpg")],
            capture_output=True,
        )
        if decoding.returncode:
            raise CaptureError("The video could not be decoded. Try an original MP4 or MOV file.")
        return fps
    reference_size = None
    for index, source in enumerate(paths, 1):
        try:
            with Image.open(source) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                if reference_size is None:
                    reference_size = image.size
                if image.size != reference_size:
                    raise CaptureError("Use photos from the same lens, resolution and orientation.")
                image.thumbnail((1440, 1440), Image.Resampling.LANCZOS)
                image.save(frames / f"{index:04}.jpg", quality=94, subsampling=0)
        except (OSError, Image.DecompressionBombError) as error:
            raise CaptureError("A photo could not be opened. Use original JPEG, PNG or WebP files.") from error
    return 1


def job_spec(job):
    return json.loads((job / "job.json").read_text())


def inspect_frames(frames, metrics):
    files = sorted(frames.glob("*.jpg"))
    metrics["sampled"] = len(files)
    if len(files) < MIN_FRAMES:
        raise CaptureError("There are too few usable views. Capture a longer, continuous pass with camera movement.")
    indices = np.linspace(0, len(files) - 1, min(16, len(files)), dtype=int)
    scores = []
    for index in indices:
        pixels = cv2.imread(str(files[index]), cv2.IMREAD_GRAYSCALE)
        height, width = pixels.shape
        scale = min(1, 640 / max(width, height))
        resized = cv2.resize(pixels, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        scores.append(cv2.Laplacian(resized, cv2.CV_64F).var())
    metrics["resolution"] = f"{width} × {height}"
    if min(width, height) < 480 or max(width, height) < 720:
        raise CaptureError("This capture is too small for the studio quality gate. Use the original camera export.")
    if np.median(scores) < 18:
        raise CaptureError("Most sampled views are too blurry or lack visible features. Walk slowly in even light.")


def measure_coverage(model, mesh, maximum=18):
    images = sorted(model.images.values(), key=lambda image: image.name)
    sample = np.linspace(0, len(images) - 1, min(len(images), maximum), dtype=int)
    ray = RayMeshIntersector(mesh)
    scores = []
    for i in sample:
        image = images[i]
        camera = model.cameras[image.camera_id]
        fx, fy, cx, cy = camera.params
        x, y = np.meshgrid(np.linspace(0.12, 0.88, 36) * camera.width,
                           np.linspace(0.28, 0.72, 20) * camera.height)
        directions = np.column_stack(((x.ravel() - cx) / fx, (y.ravel() - cy) / fy, np.ones(x.size)))
        directions = directions @ image.cam_from_world().rotation.matrix()
        centers = np.broadcast_to(image.projection_center(), directions.shape)
        scores.append((int(Path(image.name).stem), float(ray.intersects_any(centers, directions).mean())))
    return scores


def embed_tour(source, output, metadata):
    asset = source.read_bytes()
    magic, version, total, size, kind = struct.unpack_from("<4sIIII", asset)
    if (magic, version, total, kind) != (b"glTF", 2, len(asset), 0x4E4F534A):
        raise RuntimeError("The packed 3D asset has an invalid GLB header.")
    document = json.loads(asset[20:20 + size])
    document.setdefault("extras", {})["vyralTour"] = metadata
    header = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode()
    header += b" " * (-len(header) % 4)
    rest = asset[20 + size:]
    temporary = output.with_suffix(".tmp")
    temporary.write_bytes(struct.pack("<4sIIII", magic, version, 20 + len(header) + len(rest),
                                      len(header), kind) + header + rest)
    os.replace(temporary, output)


def run(job, openmvs, gltfpack, threads, resolution):
    report = job / "report.json"
    work = job / "work"
    metrics = {}
    try:
        work.mkdir()
        frames = work / "frames"
        frames.mkdir()
        write_report(report, "sampling", metrics)
        fps = prepare_frames(job, frames, threads)
        inspect_frames(frames, metrics)
        spec = job_spec(job)
        write_report(report, "tracking", metrics)
        try:
            models, sparse = track(frames, work, threads, exhaustive=spec["kind"] == "photos")
        except RuntimeError as error:
            raise CaptureError("The camera route could not be recovered. Shoot a slow continuous pass with visible detail and sideways movement.") from error
        index = max(models, key=lambda idx: (models[idx].num_reg_images(), models[idx].num_points3D()))
        registered = models[index].num_reg_images()
        metrics.update(registered=registered, components=sum(model.num_reg_images() >= 8 for model in models.values()))
        if registered < MIN_FRAMES or registered / metrics["sampled"] < MIN_REGISTRATION:
            raise CaptureError("Too few views align in one reconstruction. Shoot one connected pass and repeat corners and doorways from different positions.")

        write_report(report, "meshing", metrics)
        mvs = work / "mvs"
        build_surface(frames, sparse / str(index), mvs, openmvs, threads, resolution, 140000)
        model = pycolmap.Reconstruction(mvs / "sparse")
        mesh = trimesh.load_mesh(mvs / "mesh.ply", process=False)
        if len(mesh.faces) < 2500:
            raise CaptureError("Matching views produced too little 3D surface. Move sideways so objects shift against the background.")
        rough = measure_coverage(model, mesh)
        hero, _ = max(rough, key=lambda item: item[1])
        step = max(1, math.ceil(registered / 48))
        views, preferred = pick_views(model, 0, float("inf"), step, (hero - 0.5) / fps, fps)

        write_report(report, "texturing", metrics)
        textured = bake_atlas(mvs, model, mesh, views, preferred, atlas_edge=4096)
        coverage = measure_coverage(model, textured, maximum=24)
        scores = np.array([item[1] for item in coverage])
        metric = float(np.median(scores))
        lower = float(np.quantile(scores, 0.15))
        metrics.update(coverage=round(metric, 3), lowerCoverage=round(lower, 3), triangles=len(textured.faces))
        if len(textured.faces) < 2500 or metric < MIN_COVERAGE or lower < 0.5:
            raise CaptureError("The textured mesh has too many holes across the captured viewpoints. Add overlapping views of the missing walls, floor and doorways.")
        hero, _ = max(coverage, key=lambda item: item[1])
        poses = read_camera_track(sparse / str(index))
        metadata = create_metadata(poses, textured.vertices, (hero - 0.5) / fps, fps)
        if not math.isfinite(metadata["radius"]) or metadata["radius"] <= 0:
            raise CaptureError("The recovered outline has no usable scale. Capture more viewpoints with translation.")
        metadata.update(version=1, name=spec["name"], quality=metrics)
        write_report(report, "packaging", metrics)
        packed = work / "packed.glb"
        subprocess.run([gltfpack, "-i", str(mvs / "projected.glb"), "-o", str(packed),
                        "-c", "-vp", "15", "-vt", "14"], check=True)
        embed_tour(packed, job / "result.glb", metadata)
        write_report(report, "complete", metrics)
    except CaptureError as error:
        write_report(report, "rejected", metrics, str(error))
        return 2
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(error, flush=True)
        write_report(report, "failed", metrics,
                     "Reconstruction stopped before it produced a tour. Check the job log and try another capture.")
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path)
    parser.add_argument("--openmvs", type=Path, required=True)
    parser.add_argument("--gltfpack", default="gltfpack")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--resolution", type=int, default=960)
    args = parser.parse_args()
    return run(args.job.resolve(), args.openmvs.resolve(), args.gltfpack, args.threads, args.resolution)


if __name__ == "__main__":
    raise SystemExit(main())
