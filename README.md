# Vyral Spaces — CPU-stitched interactive virtual-tour MVP

**Live:** https://vyral-spaces-mvp.vercel.app/

This is an interactive property walkthrough prototype made entirely from the two original portrait MP4 videos supplied to the project.

## What's actually implemented
- **15 distinct room viewpoints** across **two separate apartments**.
- 360-style **look-around** viewer with drag-to-pan and clickable room-transition hotspot using [Pannellum](https://pannellum.org/).
- CPU-generated partial panoramas using **OpenCV Stitcher** from short sweeps in the supplied phone videos. When panorama stitching failed, a representative original video frame is used.
- Room thumbnails, next/previous navigation, per-property scene maps (illustrative only), mobile controls, shareable per-room URLs.
- Optionally compare each room with original uploaded phone video.
- No paid 3D scan service, reconstruction GPU, or server application required to view a tour.

## Quality limitations — important
**The source files are 360 × 640 portrait phone recordings, not spherical 360-degree images.** The panoramas stitched from their limited viewing angles are partial; they cannot look behind the camera unless the footage captured those surfaces. Some stops use individual camera frames. No physical depth, accurate floor geometry, photogrammetric reconstruction, or Matterport-grade 3D dollhouse exists in this demo. The 'Tour map' is solely an illustrative navigation aid and does not represent measured architecture. Some stitching seams or distortion may occur.

## Stack
- One HTML/CSS/JS file in `index.html`.
- Pannellum 2.5.6 from jsDelivr for interactive panoramic display.
- Real panorama images hosted on media CDN; referenced directly in `index.html`.
- Original two phone videos hosted on media CDN.
- Vercel static hosting integrated with GitHub `main`.

## Capture-to-tour production workflow
1. Film from stationary pivots, or ideally capture actual spherical equirectangular 360 photos per room.
2. Verify resolution, completeness and camera location.
3. Stitch on CPU with OpenCV or Hugin, inspect seams.
4. Create tour nodes, map real connections and add navigation hotspots.
5. Obtain accurate floor plan measurements separately for a genuine dollhouse.
6. QA on iPhone/Android mobile data.

The media are openly accessible to visitors of the linked public demo. Only publish properties with appropriate owner/occupant permission.
