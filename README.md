# Pinball Explorer

Standalone web app for browsing raw pinball SD card images.

## Run

```bash
npm install
npm start
```

Default URL:

- `http://localhost:4274`

## Notes

- The app is self-contained under `pinball-explorer/`.
- The server and worker processes read mounted raw SD images directly.
- Asset aliases and descriptions persist to `pinball-explorer/data/asset-metadata.json`.
- The frontend is plain HTML, CSS, and browser-side JavaScript with no build step.
