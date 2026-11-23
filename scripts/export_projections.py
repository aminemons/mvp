#!/usr/bin/env python3
"""Export camera matrices and low-resolution visibility maps for the baked atlas."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import pycolmap
import trimesh
from PIL import Image
from trimesh.ray.ray_pyembree import RayMeshIntersector

from project_atlas import pick_views


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--mesh", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--hero", type=float, required=True)
    parser.add_argument("--first", type=float, default=0)
    parser.add_argument("--last", type=float, default=float("inf"))
    parser.add_argument("--interval", type=int, default=3)
    parser.add_argument("--walk-first", type=float, required=True)
    parser.add_argument("--walk-last", type=float, required=True)
    args = parser.parse_args()
    model = pycolmap.Reconstruction(args.workspace / "sparse")
    views, _ = pick_views(model, args.first, args.last, args.interval, args.hero, 3)
    rt = RayMeshIntersector(trimesh.load_mesh(args.mesh, process=False))
    native = model.cameras[views[0].camera_id]
    columns = int(np.ceil(np.sqrt(len(views) * native.height / native.width)))
    rows = int(np.ceil(len(views) / columns))
    selected = [
        (idx, view) for idx, view in enumerate(views)
        if args.walk_first <= (int(Path(view.name).stem) - .5) / 3 <= args.walk_last
    ]
    if not selected:
        raise ValueError("No atlas views in the selected walk interval.")
    depth_columns = min(4, len(selected))
    depth_rows = int(np.ceil(len(selected) / depth_columns))
    width, height = 90, 160
    canvas = Image.new("L", (width * depth_columns, height * depth_rows))
    metadata = []
    for i, (atlas_idx, view) in enumerate(selected):
        cam = model.cameras[view.camera_id]
        fx, fy, cx, cy = cam.params
        grid_y, grid_x = np.mgrid[:height, :width]
        u, v = (grid_x + .5) * cam.width / width, (grid_y + .5) * cam.height / height
        local = np.stack([(u - cx) / fx, (v - cy) / fy, np.ones(u.shape)], axis=-1).reshape(-1, 3)
        rotation = view.cam_from_world().rotation.matrix()
        origin = view.projection_center()
        directions = local @ rotation
        positions, hits, _ = rt.intersects_location(
            np.broadcast_to(origin, directions.shape), directions, multiple_hits=False
        )
        depth = (positions - origin) @ rotation[2]
        ceiling = max(1., float(np.percentile(depth, 99) * 1.06))
        values = np.zeros(width * height, dtype=np.uint8)
        values[hits] = np.clip(np.rint(depth * 255 / ceiling), 1, 255).astype(np.uint8)
        dx, dy = i % depth_columns, i // depth_columns
        canvas.paste(Image.fromarray(values.reshape(height, width)), (dx * width, dy * height))
        metadata.append({
            "matrix": view.cam_from_world().matrix().round(7).tolist(),
            "origin": origin.round(6).tolist(),
            "forward": rotation[2].round(7).tolist(),
            "intrinsics": [fx / cam.width, fy / cam.height, cx / cam.width, cy / cam.height],
            "rect": [atlas_idx % columns / columns, atlas_idx // columns / rows, 1 / columns, 1 / rows],
            "depthRect": [dx / depth_columns, dy / depth_rows, 1 / depth_columns, 1 / depth_rows],
            "depthScale": round(ceiling, 5),
        })
    if not cv2.imwrite(str(args.output.with_suffix(".png")), np.asarray(canvas)):
        raise RuntimeError("Could not write visibility atlas.")
    args.output.with_suffix(".json").write_text(json.dumps(metadata, separators=(",", ":")))
    print(f"{args.output}: {len(selected)} calibrated reference views")


if __name__ == "__main__":
    main()
