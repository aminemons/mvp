#!/usr/bin/env python3
"""Recover camera poses and surface geometry from one pass of phone video."""

import argparse
import subprocess
from pathlib import Path

import pycolmap as colmap


def run(command, directory):
    subprocess.run(command, cwd=directory, check=True)


def track(frames, work, threads, exhaustive):
    database = work / "features.db"
    output = work / "sparse"
    output.mkdir()
    reader = colmap.ImageReaderOptions()
    reader.camera_model = "SIMPLE_RADIAL"
    reader.default_focal_length_factor = 0.85
    extraction = colmap.FeatureExtractionOptions()
    extraction.num_threads = threads
    extraction.sift.max_num_features = 3500
    colmap.extract_features(
        database, frames, camera_mode=colmap.CameraMode.SINGLE,
        reader_options=reader, extraction_options=extraction, device=colmap.Device.cpu,
    )

    matching = colmap.FeatureMatchingOptions()
    matching.num_threads = threads
    if exhaustive:
        colmap.match_exhaustive(database, matching_options=matching, device=colmap.Device.cpu)
    else:
        pairs = colmap.SequentialPairingOptions()
        pairs.overlap = 13
        pairs.num_threads = threads
        colmap.match_sequential(
            database, matching_options=matching, pairing_options=pairs, device=colmap.Device.cpu,
        )

    options = colmap.IncrementalPipelineOptions()
    options.num_threads = threads
    options.random_seed = 8
    options.max_num_models = 5
    options.min_model_size = 12
    options.ba_local_max_num_iterations = 30
    options.ba_global_max_num_iterations = 55
    options.mapper.init_min_num_inliers = 35
    options.mapper.init_min_tri_angle = 7
    options.mapper.abs_pose_min_num_inliers = 15
    options.mapper.filter_max_reproj_error = 2.5
    options.mapper.filter_min_tri_angle = 1.0
    options.mapper.num_threads = threads
    models = colmap.incremental_mapping(database, frames, output, options=options)
    if not models:
        raise RuntimeError("The clip did not produce a camera reconstruction.")
    for index, model in models.items():
        model.write_text(output / str(index))
        print(f"Component {index}: {model.num_reg_images()} frames, {model.num_points3D()} points", flush=True)
    return models, output


def build_surface(frames, model, work, openmvs, threads):
    work.mkdir()
    colmap.undistort_images(work, model, frames, num_threads=threads)
    mesh_steps = [
        ["InterfaceCOLMAP", "-i", ".", "--image-folder", "images", "-o", "scene.mvs"],
        ["DensifyPointCloud", "-i", "scene.mvs", "-o", "dense.mvs",
         "--resolution-level", "0", "--max-resolution", "640", "--min-resolution", "320",
         "--sub-resolution-levels", "1", "--number-views", "4", "--number-views-fuse", "2",
         "--geometric-iters", "1", "--iters", "2",
         "--fusion-depth-diff-threshold", "0.02", "--fusion-reprojection-threshold", "1.6"],
        ["ReconstructMesh", "-i", "dense.mvs", "-o", "mesh.ply",
         "--target-face-num", "85000", "--remove-spurious", "14", "--close-holes", "0",
         "--smooth", "1"],
    ]
    for executable, *args in mesh_steps:
        run([str(openmvs / executable), *args, "--max-threads", str(threads)], work)
    if not (work / "mesh.ply").is_file():
        raise RuntimeError("OpenMVS did not export a surface mesh.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("work", type=Path, help="New directory for reconstruction output")
    parser.add_argument("--openmvs", required=True, type=Path, help="Directory with OpenMVS executables")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--fps", type=float, default=3)
    parser.add_argument("--sequential", action="store_true")
    parser.add_argument("--component", type=int, help="Use a specific disconnected COLMAP component")
    args = parser.parse_args()

    video, work, binaries = (path.resolve() for path in (args.video, args.work, args.openmvs))
    if not video.is_file() or args.fps <= 0 or args.threads < 1 or work.exists():
        parser.error("Use an existing video, a new output directory, and positive fps and thread values.")
    frames = work / "frames"
    frames.mkdir(parents=True)
    run(["ffmpeg", "-loglevel", "error", "-threads", str(args.threads), "-i", str(video),
         "-vf", f"fps={args.fps}", "-q:v", "2", "-threads", "2", str(frames / "%04d.jpg")], work)

    models, sparse = track(frames, work, args.threads, not args.sequential)
    index = args.component
    if index is None:
        index = max(models, key=lambda key: (models[key].num_reg_images(), models[key].num_points3D()))
    if index not in models or models[index].num_reg_images() < 8:
        raise RuntimeError("Choose a component with at least eight registered camera positions.")
    build_surface(frames, sparse / str(index), work / "mvs", binaries, args.threads)
    print(f"Surface mesh in {work / 'mvs'} with camera poses from {sparse / str(index)}")


if __name__ == "__main__":
    main()
