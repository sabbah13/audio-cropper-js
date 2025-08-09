# Audio Cropper (Vanilla JS)

Minimal in-browser audio clipper: upload, select clips visually, play/pause/stop, and export each clip as MP3 or all clips as a ZIP. Built with Canvas + Web Audio API.

## Features
- Create, move, and resize clips by dragging over the waveform
- Global and per-clip play/pause with accurate playhead
- Single-click seek on waveform and inside clips
- Export individual clips to MP3 (preserves channels up to stereo; bitrate approximates source)
- Download all clips as ZIP (MP3s)

## Production build
This project uses Tailwind via a prebuilt CSS file.

Install deps and build CSS:

```bash
npm ci || npm install
npm run build:css
```

Serve locally:

```bash
npx http-server .
```

## Deploy to Netlify
```bash
npx netlify-cli login            # once
npx netlify-cli init             # create/link a site
npx netlify-cli deploy --prod    # deploy
```

## Security
- CSP locks scripts/styles to self; dynamic libraries are loaded from local `vendor/` first, falling back to pinned CDNs.
- No cookies; no user data leaves the browser.

## License
MIT


