# Pinball Explorer

Browse and inspect raw pinball machine SD card images.

## Quick Start

```bash
npm install
npm start
```

Opens at `http://localhost:4274`.

## Electron

```bash
npm run electron:dev        # dev mode
npm run electron:build:mac  # build for macOS
npm run electron:build:win  # build for Windows
npm run electron:build:linux
```

## Web (Vite)

```bash
npm run web:dev      # dev server
npm run web:build    # production build
npm run web:preview  # preview build
```

## How It Works

- Reads mounted raw SD card images directly via a worker process
- Parses Stern Spike platform assets (images, sounds, rules)
- Asset aliases and descriptions persist to `data/asset-metadata.json`