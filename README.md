# Within One Voice

A real-time music video for **Within One Voice** by A·ZR·ᛁ. The visuals are rendered live in your browser with three.js and driven by the song. Nothing is pre-rendered.

**Watch:** https://kaerfreki.github.io/within-one-voice/

Music & concept: A·ZR·ᛁ / Kaer Freki. Real-time three.js music video.

Press play on the start screen, because browsers need a click before they play sound. Headphones and a computer in fullscreen work best. Phones and other touch or small screens get a lighter preset automatically. Add `#low` or `#high` to the URL to choose a preset yourself.

## Run it locally

Requires Node 20 or newer.

```sh
npm ci
npx vite                    # dev server: http://localhost:5183/player.html
npm run build:site          # builds the public player into site/
npx http-server site        # serve the build (any static server that supports range requests)
```

There are three pages:
- `player.html`: the public player (start screen, fades controls while playing).
- `thoughts.html`: the same visuals with a preview HUD. Keys: Space, ←/→, 1–9, H, L.
- `index.html`: the first "dreams" version, built as separate scenes.

Add `?t=<seconds>` to start at a given time. `?debug` turns on the preview keys in the player.

## Data

- `public/song.mp3`: the track.
- `public/envelopes.json`, `public/voice.json`, `public/voice.bin`: loudness, drum hits and the vocal waveform. They are made from the stems by `scripts/analyze_stems.mjs` and `scripts/analyze_voice.mjs`.
- `timing/`: section and lyric timings for the take.

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.

© Kaer Freki. All rights reserved. The music, lyrics and artwork are not licensed for reuse.
