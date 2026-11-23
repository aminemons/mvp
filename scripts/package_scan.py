#!/usr/bin/env python3
"""Package a camera-textured GLB and its registered COLMAP capture path."""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


def read_mesh_vertices(path):
    with path.open("rb") as stream:
        header = []
        while (line := stream.readline()) and line.strip() != b"end_header":
            header.append(line.decode("ascii").strip())
        count = int(next(line.split()[-1] for line in header if line.startswith("element vertex ")))
        if "format binary_little_endian 1.0" not in header or not line:
            raise ValueError("Expected binary little-endian OpenMVS mesh")
        return np.frombuffer(stream.read(count * 12), dtype="<f4").reshape(count, 3)


def read_camera_track(model):
    lines = [line for line in (model / "images.txt").read_text().splitlines() if not line.startswith("#")]
    poses = []
    for line in lines[::2]:
        _, qw, qx, qy, qz, tx, ty, tz, _, filename = line.split()
        attitude = Rotation.from_quat([float(qx), float(qy), float(qz), float(qw)]).inv()
        center = attitude.apply(-np.array([float(tx), float(ty), float(tz)]))
        frame = int(Path(filename).stem)
        poses.append((frame, center, attitude))
    return sorted(poses, key=lambda pose: pose[0])


def create_metadata(poses, vertices, start, fps):
    directions_up = np.array([attitude.apply([0, -1, 0]) for _, _, attitude in poses])
    average_up = np.median(directions_up, axis=0)
    average_up /= np.linalg.norm(average_up)
    align = Rotation.align_vectors([[0, 1, 0]], [average_up])[0]
    convention = Rotation.from_rotvec([np.pi, 0, 0])
    poses_web = [
        {"p": align.apply(center).round(5).tolist(),
         "q": (align * attitude * convention).as_quat().round(7).tolist(),
         "t": round((frame - 0.5) / fps, 3)}
        for frame, center, attitude in poses
    ]
    geometry = align.apply(vertices)
    lo, hi = np.percentile(geometry, [2, 98], axis=0)
    radius = float(np.linalg.norm(hi - lo)) * 0.5
    return {
        "poses": poses_web,
        "alignment": align.as_quat().round(8).tolist(),
        "start": min(range(len(poses_web)), key=lambda i: abs(poses_web[i]["t"] - start)),
        "center": ((hi + lo) * 0.5).round(4).tolist(),
        "radius": round(radius, 4),
        "speed": round(radius * 0.245, 4),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--mvs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--gltfpack", default="gltfpack", type=str)
    parser.add_argument("--start", default=0, type=float)
    parser.add_argument("--first", default=0, type=float)
    parser.add_argument("--last", default=float("inf"), type=float)
    parser.add_argument("--fps", default=3, type=float)
    args = parser.parse_args()

    poses = [pose for pose in read_camera_track(args.model)
             if args.first <= (pose[0] - 0.5) / args.fps <= args.last]
    if len(poses) < 2:
        parser.error("The selected camera interval needs at least two registered frames.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    vertices = read_mesh_vertices(args.mvs / "mesh.ply")
    metadata = create_metadata(poses, vertices, args.start, args.fps)
    subprocess.run([
        args.gltfpack, "-i", str(args.mvs / "projected.glb"),
        "-o", str(args.output.with_suffix(".glb")), "-c", "-vp", "15", "-vt", "14",
    ], check=True)
    args.output.with_suffix(".json").write_text(json.dumps(metadata, separators=(",", ":")))


if __name__ == "__main__":
    main()
