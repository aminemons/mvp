#!/usr/bin/env python3
"""Bake visible pixels from registered images onto the observed surface."""

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import pycolmap as colmap
import trimesh
from PIL import Image
from trimesh.ray.ray_pyembree import RayMeshIntersector


def pick_views(model, first, last, interval, hero, fps):
    items = sorted(model.images.values(), key=lambda image: image.name)
    frames = [item for item in items if first <= (int(Path(item.name).stem) - 0.5) / fps <= last]
    if not frames:
        raise ValueError("The interval has no registered views.")
    chosen = frames[::interval]
    if frames[-1] not in chosen:
        chosen.append(frames[-1])
    preferred = min(frames, key=lambda item: abs((int(Path(item.name).stem) - 0.5) / fps - hero))
    if preferred not in chosen:
        chosen.append(preferred)
    return chosen, preferred


def assign_views(mesh, views, preferred, model):
    origins = mesh.triangles_center
    faces = mesh.faces
    ray = RayMeshIntersector(mesh)
    assignments = np.full(len(faces), -1, np.int32)
    strengths = np.zeros(len(faces))
    projections = []
    for i, image in enumerate(views):
        camera = model.cameras[image.camera_id]
        w, h = camera.width, camera.height
        fx, fy, cx, cy = camera.params
        matrix = image.cam_from_world().matrix()
        C = image.projection_center()
        vertices = np.asarray(mesh.vertices) @ matrix[:, :3].T + matrix[:, 3]
        depth = vertices[:, 2]
        pixels = vertices[:, :2] / np.maximum(depth[:, None], 1e-6) * [fx, fy] + [cx, cy]
        projections.append(pixels)
        visible_vertices = (depth > 0.035) & (pixels[:, 0] > 1) & (pixels[:, 1] > 1)
        visible_vertices &= (pixels[:, 0] < w - 2) & (pixels[:, 1] < h - 2)
        face_ids = np.flatnonzero(visible_vertices[faces].all(axis=1))
        vectors = origins[face_ids] - C
        lines = np.broadcast_to(C, vectors.shape)
        closest = ray.intersects_first(lines, vectors)
        passes = closest == face_ids
        face_ids = face_ids[passes]
        vectors = vectors[passes]
        distances = np.linalg.norm(vectors, axis=1)
        facing = np.abs(np.einsum('ij,ij->i', mesh.face_normals[face_ids], vectors)) / distances
        pixel_centers = pixels[faces[face_ids]].mean(axis=1)
        edges = np.minimum(pixel_centers, [w, h] - pixel_centers) / [w, h]
        center_weight = np.clip(edges.min(axis=1) / 0.12, 0.2, 1)
        strength = (0.3 + 0.7 * facing) * center_weight / np.maximum(distances, 0.2) ** 0.45
        if image.name == preferred.name:
            strength *= 2.25
        improves = strength > strengths[face_ids]
        ids = face_ids[improves]
        strengths[ids] = strength[improves]
        assignments[ids] = i
    return assignments, projections


def write_glb(path, positions, texcoords, indices, material_texture):
    slices = []
    blob = bytearray()
    for array in (positions, texcoords, indices):
        slices.append(dict(buffer=0, byteOffset=len(blob), byteLength=array.nbytes))
        blob.extend(array.tobytes())
        blob.extend(b'\0' * (-len(blob) % 4))
    layout = {
        'asset': {'version': '2.0', 'generator': 'Vyral Spaces camera-projected photogrammetry'},
        'extensionsUsed': ['KHR_materials_unlit'], 'extensionsRequired': ['KHR_materials_unlit'],
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1},
                                    'indices': 2, 'material': 0}]}],
        'materials': [{'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}},
                       'extensions': {'KHR_materials_unlit': {}}}],
        'textures': [{'source': 0}], 'images': [{'uri': material_texture}],
        'buffers': [{'byteLength': len(blob)}], 'bufferViews': slices,
        'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(positions), 'type': 'VEC3',
                       'min': positions.min(axis=0).tolist(), 'max': positions.max(axis=0).tolist()},
                      {'bufferView': 1, 'componentType': 5126, 'count': len(texcoords), 'type': 'VEC2'},
                      {'bufferView': 2, 'componentType': 5125, 'count': len(indices), 'type': 'SCALAR'}],
    }
    header = json.dumps(layout, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28 + len(header) + len(blob), len(header), 0x4E4F534A)
                     + header + struct.pack('<II', len(blob), 0x004E4942) + blob)


def main():
    parser = argparse.ArgumentParser(description='Bake real views onto the reconstructed texture mesh.')
    parser.add_argument('workspace', type=Path)
    parser.add_argument('--first', type=float, default=0)
    parser.add_argument('--last', type=float, default=float('inf'))
    parser.add_argument('--interval', type=int, default=3)
    parser.add_argument('--hero', type=float, required=True)
    parser.add_argument('--fps', type=float, default=3)
    args = parser.parse_args()
    if args.fps <= 0 or args.interval < 1 or args.last < args.first:
        parser.error("Choose a positive frame rate, stride, and time interval.")
    work = args.workspace
    model = colmap.Reconstruction(work / 'sparse')
    mesh = trimesh.load_mesh(work / 'mesh.ply', process=False)
    views, preferred = pick_views(model, args.first, args.last, args.interval, args.hero, args.fps)
    assignments, projections = assign_views(mesh, views, preferred, model)
    camera = model.cameras[views[0].camera_id]
    unit_w, unit_h = camera.width, camera.height
    columns = int(np.ceil(np.sqrt(len(views) * unit_h / unit_w)))
    rows = int(np.ceil(len(views) / columns))
    atlas_w, atlas_h = columns * unit_w, rows * unit_h
    atlas = Image.new('RGB', (atlas_w, atlas_h), (42, 42, 46))
    retained = np.flatnonzero(assignments >= 0)
    if not len(retained):
        raise RuntimeError("None of the mesh faces have a visible reference view.")
    selected_faces = np.asarray(mesh.faces[retained])
    positions = np.asarray(mesh.vertices[selected_faces.reshape(-1)], dtype='<f4')
    texcoords = np.zeros((len(retained), 3, 2), dtype='<f4')
    for i, view in enumerate(views):
        ox, oy = i % columns * unit_w, i // columns * unit_h
        with Image.open(work / 'images' / view.name) as image:
            atlas.paste(image, (ox, oy))
        mask = assignments[retained] == i
        texcoords[mask] = (projections[i][selected_faces[mask]] + [ox + 0.5, oy + 0.5]) / [atlas_w, atlas_h]
    print(f'{len(retained)}/{len(assignments)} observed triangles with {len(views)} reference views, {atlas_w}×{atlas_h} atlas', flush=True)
    atlas.save(work / 'projected.jpg', quality=91, optimize=True, subsampling=0)
    write_glb(work / 'projected.glb', positions, texcoords.reshape(-1, 2),
              np.arange(len(positions), dtype='<u4'), 'projected.jpg')


if __name__ == '__main__':
    main()
