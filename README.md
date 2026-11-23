# Vyral Spaces — spatial real-estate MVP

**Live:** https://vyral-spaces-mvp.vercel.app/

This is an interactive Google-Earth-inspired property explorer made with real footage supplied for the pilot. The initial video-player prototype has been replaced with a full-screen 3D-oriented interface.

## Features now implemented

- Orbit, tilt, pan and zoom around a Three.js **conceptual 3D apartment** (mouse/touch/trackpad).
- Pick a room by clicking the 3D layout, floor-plan rectangle or photo card.
- Animated camera flight to the selected room; guided flyover across the property.
- Photo exploration using still frames **extracted from the uploaded videos** and CPU-stitched **partial room sweeps** (where capture overlap permitted).
- Interactive conceptual floor plan and room navigator, synchronized with the selected room.
- Real room photos displayed within the 3D model as photo panels.
- Both properties remain separate, with direct shareable URLs (`#tour-1`, `#tour-2`).
- Original videos available on demand, with browser playback controls.
- Responsive desktop/mobile layout and reduced-motion CSS support.

## Honesty about capture quality

The supplied videos are ordinary **360 × 640 portrait MP4 recordings**, *not* spherical 360° camera media or depth scans.

The scene mesh is **manually authored and illustrative**. Its dimensions, room boundaries and room positions must **not** be presented as measurements. The 3D furniture shapes are stylized, not photogrammetric reconstructions.

The still images and partial video sweeps **are derived from the original recordings**. CPU-based OpenCV panorama stitching was run only over selected turning sequences and can cover only filmed angles. The image processing did not require a CUDA GPU. Visitors' devices do use ordinary WebGL graphics to render the 3D model.

This is a proof of viewer interaction. It is **not yet a Matterport-quality scanned virtual tour**.

## Implementation

| Layer | Technology |
|---|---|
| Interactive model, orbit and camera flight | Three.js 0.175, OrbitControls |
| Geometry, furniture and floor materials | Procedural Three.js meshes and canvas textures |
| Photo navigation and UI | Native HTML/CSS/JavaScript |
| Source video processing | FFmpeg and OpenCV CPU stitching |
| Photos and original videos | Uploaded media hosted on external CDN |
| Site hosting | Vercel static deployment from the `main` branch |

No paid AI API, backend rendering GPU, database or framework build step is required.

## Run locally

Serve the repository as a static website, for example:

```bash
python -m http.server 8080
```

Open `http://localhost:8080`. Internet access is required to load the pinned Three.js CDN module and hosted property media.

## Browser QA performed on the production deployment

A Chromium / Playwright desktop and mobile smoke test confirmed:
- Initial 3D scene mounted, canvas sized and loading overlay dismissed.
- Switching to a bathroom produced a loaded 1300px-wide CPU-stitched room photo.
- Floor-plan view generated six clickable regions for property 01.
- Switching property displayed eight room stops for property 02.
- Mobile layout at 390px did not overflow horizontally.
- No JavaScript page errors or console errors were recorded during those tested flows.

## The production-grade next step

For an actually accurate Matterport-style experience, collect (1) full-resolution equirectangular 360° images at all navigation nodes, (2) a measured architectural floor plan or depth scan, and (3) recorded camera positions/doors. Use that common coordinate system to bind real panoramic viewpoints to a textured 3D dollhouse. CPU-only post-processing and hosted viewer delivery remain possible for that workflow. Ordinary portrait video alone cannot recover missing directions or measured room geometry.

## Media provenance and hosting notes

The pilot uses two user-provided WhatsApp videos plus derived stills/sweeps. These images are hosted externally for the demo. **For commercial client delivery, move assets into company-controlled object storage**, obtain appropriate client publication permission, and provide an export/retention policy. External media URLs may not be guaranteed permanent.
