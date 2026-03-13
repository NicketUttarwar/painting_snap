# Section Image Correction Editor

Web app to correct and combine painting section images: load a set of section photos, adjust rotation and boundaries, place sections with shared edges, then preview and export a single composite image.

## Features

- **Choose set** — Load image sets from `source_images/` (one folder per painting/session).
- **Rotate & move** — Rotate sections 90° and reorder layers; drag to reposition.
- **Boundary** — Define the outer crop boundary (redo auto from corners, add/remove corners).
- **Place sections** — Lock sections by dragging from center onto another; shared edges with no gaps.
- **Preview & save** — Preview the straightened composite and save to `output_defaults/` (manifest + section PNGs + composite).

Exports are written via the server’s save API, so the app must be run with `npm start` (not opened as a file).

## Requirements

- Node.js 18+
- Image sets in `source_images/` — each subfolder should contain a `manifest.json` and section images (e.g. `section-0.png`, `section-1.png`) and optionally a `composite.png`.

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3333** in your browser.

## Project structure

```
painting_snap/
├── index.html       # App UI
├── server.js        # Express server (static files + POST /api/save-export)
├── css/main.css     # Styles
├── js/
│   ├── app.js       # Main app logic and canvas UI
│   ├── export.js    # Build export canvas, save to output_defaults
│   ├── manifest.js  # Load manifest and section images
│   ├── straighten.js
│   ├── partition.js
│   ├── warp.js
│   └── ...          # Other editor modules
├── source_images/   # Input: one folder per image set (manifest + section images)
└── output_defaults/ # Output: saved exports (created at runtime, gitignored)
```

## API

- **GET /api/health** — Returns `{ ok: true, saveExport: true }` when the save API is available.
- **POST /api/save-export** — Saves an export: `folderName`, `manifest` (JSON string), and multipart image files. Writes to `output_defaults/<folderName>/`.

## License

Use and modify as needed for your project.
