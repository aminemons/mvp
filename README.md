# Vyral Spaces — interactive walkthrough MVP

Live demo: https://vyral-spaces-mvp.vercel.app

A zero-GPU, static prototype demonstrating a real-estate browsing experience using **two actual phone recordings**, one per property.

## Current features
- Production-hosted, responsive video-tour viewer
- Accurate *timeline* links to manually inspected room stops (not synthesized 360)
- Play / pause / seek / sound / fullscreen / next and previous room
- Two switchable property studies, with shareable direct links `#tour-01` and `#tour-02`
- Tap-to-navigate, **illustrative and not-to-scale** floor plan and CSS isometric room concept
- Real uploaded footage hosted separately on a media CDN; no serverless transcoding and no GPU

## What it does not do
These inputs are **360 × 640 portrait MP4 videos**, not 360° equirectangular captures, LiDAR scans or georeferenced floor plans. It is therefore technically impossible to derive a truthful, full Matterport-style dollhouse or complete spherical panoramas from these two clips alone. The spatial layouts are conceptual navigation aids; **they are not measured property geometry**.

Do not present this as a Matterport-equivalent 3D scan, production camera model, or measured property plan.

## Run
Open `index.html` in a modern browser or use any static web server. There is no build step, backend, API key or GPU requirement. Hosted media URLs in `index.html` require an internet connection.

## Next production-grade milestone
1. Collect 360° equirectangular photos at linked camera positions, plus a dimensioned floor plan.
2. Add CPU-supported quality validation, panorama tiling and a tour-editing interface for room links.
3. Turn the measured plan into a GLB apartment with Blender or other open-source tooling.
4. Unify panorama positions, dollhouse and floor plan under the same coordinate frame.
5. Test export, mobile memory/bandwidth, and property consent before offering client delivery.

### Provenance
The media are the two phone videos supplied for this MVP. No property imagery or room dimensions were invented as if captured by sensors.
