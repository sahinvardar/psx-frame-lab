# PSX Frame Lab

PSX Frame Lab is a local browser tool for inspecting DuckStation PS1 GPU dumps. It replays GPU commands, visualizes VRAM and projected geometry, and can export rendered frames without uploading capture data.

## Quick start

Double-click `dist/PSX-Frame-Lab.html` in a modern browser. The standalone file includes the worker, decoder, renderer, and Zstandard library, so no server or internet connection is required.

Choose **Open GPU dump** or drop a `.psxgpu` or `.psxgpu.zst` file anywhere. Choose **Open folder** to build a local preview strip of every supported dump in a folder, then select a preview to inspect that capture. Folder previews are generated one at a time in your browser. Files are read locally and never uploaded. **Load demo** creates a synthetic capture with no bundled game data.

For modular-source development, use the included Vite server. The standalone HTML supports direct file opening; the modular `index.html` requires an HTTP server for the worker.

## Development

Requires Node.js 18 or newer.

```sh
npm install
npm run dev
npm test
npm run build
npm run format
```

`npm run dev` serves `dist/` at `http://localhost:5173` and automatically reloads the browser when source files change.

`npm run build` regenerates `dist/PSX-Frame-Lab.html`.

`npm run format` formats the maintained HTML, CSS, JavaScript, build script, and tests. Use `npm run format:check` in automated checks.

The default test suite runs all self-contained checks. Capture-backed integration checks also run when their scripts receive the required dump paths directly.

## Controls

- Click a command to replay through it; the selected command is included.
- Use the arrow buttons or Left and Right keys to step one command.
- Use the inner jump arrows to skip to the previous or next drawing command.
- Home and End jump to the initial state and end. Space starts or pauses playback.
- Type a command number and press Enter to jump.
- Drag to pan and scroll to zoom in frame replay. **Reset view** fits the frame.
- Drag to orbit, Shift-drag or right-drag to pan, and scroll to zoom in the geometry explorer.
- Layer separation assigns synthetic depth based on command order.
- Hover over VRAM for coordinates, the raw 16-bit value, 5-bit RGB, and mask bit.
- Selected textured commands highlight the texture page and palette.
- **Draw target** crops to the current drawing area; **Display buffer** shows the configured output region.
- PNG exports save the final frame or raw VRAM without region overlays.
- **Capture statistics** summarizes triangle, quad, rectangle, line, and polyline draw commands, plus textured and Gouraud subsets and VRAM fills.

## Geometry view

PS1 GPU dumps contain already-projected XY vertices. They do not contain original world-space positions, depth, camera matrices, hidden surfaces, or game objects. The geometry explorer uses projected polygons, vertex colors, and optional synthetic depth. It is not an original-world free camera. Textures are rendered in frame replay, not in the illustrative geometry view.

## Rendering limits

This is an approximate software inspection renderer, not cycle-accurate emulation. It supports polygons, lines, rectangles, Gouraud shading, 4/8-bit indexed and 15-bit textures, texture windows, palette lookups, semi-transparency, dithering, mask bits, and VRAM fill/upload/copy operations.

Raster edges, texture-cache feedback, overlapping transfers, and exact hardware rounding can differ. Interlaced fields and 24-bit output are not reconstructed accurately. GPU reset or buffer-reset interleaved inside an incomplete GP0 command is not modeled. VSync markers define intervals; they do not guarantee unique game frames.

## Formats and limits

- Legacy 14-byte `PSXGPUDUMPv1` and standard 16-byte `PSXGPUDUMPv1r1`
- Raw and Zstandard-compressed input; decompress `.xz` files first
- Up to 64 MB decompressed and 100,000 GP0 commands
- Unknown GP0 opcodes and malformed packets report an error
- Unsupported container packets are skipped with a warning

## Project structure

- `dist/index.html` - interface
- `dist/style.css` - appearance
- `dist/app.js` - browser state, interactions, canvas views, and synthetic demo
- `dist/engine.js` - dump parser, command decoder, software GPU, and texture preview
- `dist/worker.js` - decompression, replay orchestration, seek checkpoints, and high-resolution replay
- `dist/vendor/fzstd.js` - fzstd 0.1.1, with its MIT license alongside it
- `build-offline.cjs` - standalone HTML builder
- `test-*.cjs` - parser, renderer, bundle, texture, snapshot, and resolution checks

`dist/PSX-Frame-Lab.html` is generated. Make changes in the modular files above and run `npm run build` rather than editing the standalone bundle directly.

## Texture preview

Select a textured drawing command to see a decoded UV-bounds crop in **Command details**. Expand **Full texture page + UV outline** for the 256-by-256 page and polygon UV outline. Transparency is shown over a checkerboard.

Pre-command VRAM, the selected palette, and texture-window settings are used. Colors are original texture colors before vertex-color modulation or blending; the crop is the UV bounding rectangle, not a polygon-masked image. This preview does not simulate the PS1 texture cache.

## High-resolution replay

Use the **Replay resolution** dropdown above the frame to select **1x Native**, **2x**, or **4x**. Polygons and rectangles are drawn at the selected internal resolution, and final-frame PNG exports use it too.

Native VRAM and palette previews remain unchanged. Textures, restored snapshot pixels, line primitives, and VRAM transfer results retain native detail; transfers are resampled from native VRAM. Higher settings consume more memory and can make scrubbing slower.

## Validation

The renderer has been checked against compressed Spyro and Metal Gear Solid captures. Coverage includes deterministic seek/replay, both file headers, split-packet commands, truncated-file rejection, triangle and subpixel coverage, VRAM upload/copy, mask behavior, 4/8-bit palettes, texture previews, snapshot restoration, and 1x/4x browser switching. No game dump is included in the distribution.

Synthetic pre-trace VRAM uploads restore captured words exactly while preserving mask flags for recorded commands. Regression coverage includes packed-index ordering, transparent zero data, mask-check bypass during restore, and recorded upload behavior.

## References

- [PSX GPU dump format](https://github.com/ps1dev/standards/blob/main/GPUDUMP.md)
- [DuckStation GPU dump implementation](https://github.com/stenzek/duckstation/blob/master/src/core/gpu_dump.cpp)
- [PlayStation GPU documentation](https://psx-spx.consoledev.net/graphicsprocessingunitgpu/)
