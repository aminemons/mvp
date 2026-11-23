#!/usr/bin/env python3
"""Complete visible gaps in a scan with relative depth calibrated to its measured geometry."""

import argparse
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import pycolmap
import trimesh
from scipy.ndimage import distance_transform_edt, gaussian_filter
from trimesh.ray.ray_pyembree import RayMeshIntersector


def predict_inverse_depth(path, model, size):
    rgb = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    resized = (size, max(14, round(size * height / width / 14) * 14))
    pixels = cv2.resize(rgb, resized, interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    inputs = ((pixels - mean) / std).transpose(2, 0, 1)[None]
    depth = model.run(None, {model.get_inputs()[0].name: inputs})[0].squeeze()
    return cv2.resize(depth, (width, height), interpolation=cv2.INTER_CUBIC)


def estimate_depth(mesh, image, camera, prediction, spacing):
    fx, fy, cx, cy = camera.params
    y, x = np.mgrid[0:camera.height:spacing, 0:camera.width:spacing]
    local = np.stack([(x - cx) / fx, (y - cy) / fy, np.ones(x.shape)], axis=-1)
    rotation = image.cam_from_world().rotation.matrix()
    rays = local.reshape(-1, 3) @ rotation
    origin = image.projection_center()
    origins = np.broadcast_to(origin, rays.shape)
    points, idx, _ = RayMeshIntersector(mesh).intersects_location(origins, rays, multiple_hits=False)
    distances = np.zeros(x.size)
    distances[idx] = (points - origin) @ rotation[2]
    measured = distances.reshape(x.shape)
    valid = measured > 0.03
    if valid.mean() < 0.28:
        return None
    guess = prediction[y, x]
    d_lo, d_hi = np.percentile(measured[valid], [3, 98])
    fit_mask = valid & (measured >= d_lo) & (measured <= d_hi)
    expected = 1 / measured[fit_mask]
    design = np.column_stack((guess[fit_mask], np.ones(len(expected))))
    weights = np.ones(len(expected))
    for _ in range(6):
        weights_sqrt = np.sqrt(weights)
        scale, offset = np.linalg.lstsq(
            design * weights_sqrt[:, None], expected * weights_sqrt, rcond=None
        )[0]
        errors = expected - (design @ [scale, offset])
        mad = np.median(np.abs(errors - np.median(errors)))
        weights = np.minimum(1, (1.8 * mad + 1e-5) / np.maximum(np.abs(errors), 1e-5))
    correlation = np.corrcoef(expected, guess[fit_mask])[0, 1]
    if scale <= 0 or correlation < 0.55:
        return None

    inverse = np.clip(scale * guess + offset, 1 / (d_hi * 1.16), 1 / (d_lo * 0.74))
    # Near a measured edge use its smoothly tapered correction to reduce cracks.
    distance, nearest = distance_transform_edt(~fit_mask, return_indices=True)
    residual = np.zeros(guess.shape)
    residual[fit_mask] = 1 / measured[fit_mask] - inverse[fit_mask]
    correction = gaussian_filter(residual[tuple(nearest)], sigma=1.15)
    weight = np.exp(-distance / 7) * np.exp(-np.abs(guess - guess[tuple(nearest)]) / 1.1)
    inverse += np.clip(correction * weight, -0.18 * inverse, 0.18 * inverse)
    solved = np.where(valid, measured, 1 / inverse)
    return local * solved[..., None] @ rotation + origin, solved, valid, correlation


def recover_patch(vertices, depths, measured):
    height, width = depths.shape
    grid = np.arange(height * width).reshape(height, width)
    a, b, c, d = grid[:-1, :-1], grid[:-1, 1:], grid[1:, :-1], grid[1:, 1:]
    faces = np.concatenate([np.stack([a, c, b], axis=-1), np.stack([b, c, d], axis=-1)]).reshape(-1, 3)
    missing = ~measured.ravel()[faces]
    depths_at_faces = depths.ravel()[faces]
    continuous = depths_at_faces.max(axis=1) <= 1.18 * depths_at_faces.min(axis=1)
    chosen = faces[missing.any(axis=1) & continuous]
    if not len(chosen):
        return None
    used, packed = np.unique(chosen, return_inverse=True)
    return trimesh.Trimesh(vertices=vertices.reshape(-1, 3)[used], faces=packed.reshape(-1, 3), process=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--frames", nargs="+", type=int, required=True)
    parser.add_argument("--spacing", default=6, type=int)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.spacing < 2:
        parser.error("Use a grid spacing of at least two pixels.")
    workspace = args.workspace
    colmap = pycolmap.Reconstruction(workspace / "sparse")
    images = {int(Path(image.name).stem): image for image in colmap.images.values()}
    mesh = trimesh.load_mesh(workspace / "mesh.ply", process=False)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 3
    network = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
    for frame in args.frames:
        image = images[frame]
        guess = predict_inverse_depth(workspace / "images" / image.name, network, 392)
        estimate = estimate_depth(mesh, image, colmap.cameras[image.camera_id], guess, args.spacing)
        if estimate is None:
            print(f"{image.name}: insufficient depth agreement")
            continue
        vertices, depth, valid, agreement = estimate
        patch = recover_patch(vertices, depth, valid)
        if patch is not None:
            print(f"{image.name}: {valid.mean():.1%} measured coverage, {agreement:.2f} depth fit, "
                  f"{len(patch.faces)} estimated faces")
            mesh = trimesh.util.concatenate([mesh, patch])
    mesh.export(args.output)


if __name__ == "__main__":
    main()
