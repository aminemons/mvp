# Vyral Spaces Studio

[Open the hosted Studio](https://vyral-spaces-mvp.vercel.app/)

Build a 3D tour from your footage and inspect the result in an interactive browser viewer. The local worker runs on CPU and uses FFmpeg, COLMAP, OpenMVS, Embree and glTF mesh compression. The hosted site opens exported tours and shows setup. It has no reconstruction worker.

## Try it yourself

1. Start Docker Desktop on Windows, or Docker with Compose on Linux. This worker image uses Linux x86-64.
2. Clone this repository or extract [the project ZIP](https://github.com/aminemons/mvp/archive/refs/heads/main.zip). Open a terminal in the extracted project folder.
3. Run the command below and open [the local Studio](http://127.0.0.1:8080/).

```sh
docker compose up --build
```

Choose one original video or 12–180 overlapping photos, enter a tour name and select **Build tour**. Photo files are processed in natural filename order. The worker shows sampling, camera tracking, meshing, texturing and packaging in the job panel. A job that passes the checks lets you **Explore tour** and **Download GLB**. The GLB embeds its textures and camera route. Use **Open a tour file** in the hosted or local viewer to open it in the browser.

Video limit is 1 GB. Photo sets may total 500 MB. The worker defaults to four CPU threads, processes one scan at a time, and stores captures and results in a local Docker volume. The first build downloads the open-source dependencies. The browser viewer loads Three.js from jsDelivr. Source footage is never sent to Vercel.

## Capture and quality

Start with one well-lit room. Make a slow pass, shift sideways and keep features in view across neighboring frames. Film the corners, floor, and both sides of doorways. Keep one lens and use the original files. For photos, use the same orientation and dimensions throughout the set.

The worker screens for resolution and blur, then measures how many frames align in a single reconstruction and how much of the textured mesh is visible from sampled camera poses. Those checks screen for failed scans. Always inspect the view and walk path before sharing. Lighting, texture quality, lenses, and capture overlap affect the result, and the exported scale is relative.

## Linux without Docker

Install FFmpeg, the OpenMVS 2.4.0 Linux binaries, and `gltfpack@1.0.0` (available via npm). Install the Python dependencies and start the same local worker.

```sh
python -m pip install -r requirements-studio.txt
python scripts/studio_server.py --openmvs /path/to/openmvs
```

The old `#tour-1` and `#tour-2` links still open the sample scans. Those samples came from compressed phone footage and show the limitations of incomplete capture.

## Reconstruction results

Both MP4s are portrait 360 × 640 WhatsApp recordings. Camera intrinsics and poses were solved with CPU COLMAP. OpenMVS estimated depth from adjacent views, fused depth supported by multiple views, and reconstructed a surface. Near the published views, relative depth from Depth Anything V2 Small is calibrated to the measured mesh and used to fill visible gaps. Each retained face is textured with original pixels from a calibrated view that can see it. Walk mode blends nearby source views on the 3D surface and uses per-view depth to reject occluded pixels. The browser renders these triangles and textures at each new camera position.

| Property | Sampled frames | Registered in published mesh | Fused 3D points | Textured triangles | Walk coverage |
| --- | ---: | ---: | ---: | ---: | --- |
| Courtyard residence | 130 | 126 | 188,062 | 99,634 | Living room, 39.5–43.2 s of capture |
| Tiled residence | 173 | 44 | 55,684 | 71,305 | Front rooms, 1.2–4.8 s of capture |

The geometry has arbitrary scale. Windows, reflections, unobserved surfaces, and rooms without enough overlapping viewpoints have gaps. Walk mode bounds position and viewing angles around the recovered camera route. It checks for collisions with the reconstructed mesh. Orbit exposes the entire recovered mesh and makes gaps visible. The two source properties have independent reconstructions.
