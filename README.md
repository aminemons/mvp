# Vyral Spaces

[Open the live 3D tour](https://vyral-spaces-mvp.vercel.app/)

Vyral Spaces renders a single textured 3D mesh per property. Drag to look around, use WASD or the arrow keys to move relative to the direction you face. The wheel steps forward or back. On touch screens, hold the on-screen arrows to walk. Orbit shows the mesh from outside. The inset in Walk mode plots the actual tracked camera route.

## Reconstruction results

Both MP4s are portrait 360 × 640 WhatsApp recordings. Camera intrinsics and poses were solved with CPU COLMAP. OpenMVS estimated depth from adjacent views, fused depth supported by multiple views, and reconstructed a surface. Each face is then textured by projecting original pixels from a calibrated view that can see it. The browser renders these triangles and textures at each new camera position.

| Property | Sampled frames | Registered in published mesh | Fused 3D points | Textured triangles | Walk coverage |
| --- | ---: | ---: | ---: | ---: | --- |
| Courtyard residence | 130 | 126 | 188,062 | 83,295 | Living and dining section, 19.5–33.8 s of capture |
| Tiled residence | 173 | 44 | 55,684 | 66,139 | Front rooms, 1.2–4.8 s of capture |

The geometry has arbitrary scale. Windows, reflections, unobserved surfaces, and rooms without enough overlapping viewpoints have gaps. Walk mode lets visitors move and steer freely within a volume around the best-supported sections of the recovered routes. It checks for collisions with the reconstructed mesh. Orbit exposes the entire recovered mesh and makes gaps visible. The two source properties have independent reconstructions.

## Run the viewer

```bash
python -m http.server 8080
```

Open <http://localhost:8080>. The viewer uses pinned Three.js modules from jsDelivr. WebGL2 renders at full resolution, with a lower-resolution CPU rasterizer for browsers without WebGL. Meshes, texture atlases and routes are served as static files. The historic `/scan.html` URL redirects to the current viewer.

## Build a scan from source footage

Use FFmpeg, Python with `pycolmap==4.2.1`, NumPy, SciPy, Pillow, trimesh and embreex, [OpenMVS 2.4.0](https://github.com/cdcseacave/openMVS/releases/tag/v2.4.0), and `gltfpack@1.0.0`.

```bash
python scripts/build_mesh.py capture.mp4 work/pilot --openmvs /path/to/openmvs
python scripts/project_atlas.py work/pilot/mvs --hero 20.5
python scripts/package_scan.py \
  --model work/pilot/sparse/0 --mvs work/pilot/mvs \
  --output assets/scans/pilot --first 19.5 --last 33.8 --start 20.5
```

Use the COLMAP component printed by the first command. Inspect the geometry and camera path before choosing the `--first`, `--last` and `--start` times. An index entry in `assets/scans/index.json` binds the verified mesh and route to the property picker. The older GitHub Actions workflow targets the retired point-cloud format and is independent of this mesh build.

## Capture a more complete tour

Use original, full-resolution footage with one lens and steady exposure. Walk a slow loop per room and move sideways while looking at each wall so adjacent views record real parallax. Include the floor, ceiling, and corners. Record both sides of each doorway and walk through it without cutting. Revisit the first viewpoint before ending the capture.

A 360° camera can record additional high-resolution color coverage. Capture at multiple positions, then register the panoramic views to the same reconstructed geometry. A single panorama can provide a sharp look-around from its capture point. Movement between capture points requires a supported 3D surface and overlapping views. The current example uses overlapping phone frames as the color source.

COLMAP + OpenMVS are the CPU mesh pipeline exercised here. OpenMVG + OpenMVS and MicMac are alternative CPU photogrammetry stacks. OpenSplat can train Gaussian splats on CPU, with a substantial runtime cost. A splat can improve captured appearance, and a separate mesh can supply walk collision.
