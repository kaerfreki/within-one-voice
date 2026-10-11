# Thoughts: the second version of the visuals

`thoughts.html` is a new version of the video, alongside the first one (`index.html`), which is unchanged. It's one continuous swarm of 262,144 points of light, driven by the song. It doesn't cut between scenes: the swarm drifts, gathers into shapes, flocks and dissolves. The voice is never drawn: an early pass showed the vocal waveform as a line of light, but it read as a sound meter rather than a dream, so it was removed. The audio still drives the swarm under the surface (drum kicks, loudness, the pupil of the eye).

## Running it
Open http://localhost:5183/thoughts.html with the dev server running (`npx vite` in this folder).
- **Keys:** the same as v1: Space, ←/→, 1–9, H, L.
- **`?scale=1`:** previews at full 1080p.
- **`?capture&take=th01[&from=s&to=s]`:** renders 1920x1080 frames at 24 fps into `../renders/dreams/<take>/`. The console prints the ffmpeg mux command.
- **`?debug`:** keeps the canvas pixels so you can save stills from the console. For example, `grab([84, 200, 236], 'look')` writes `../renders/dreams/look/`.

The simulation advances in fixed 1/24 s steps. After a jump, the app re-runs the 4 s before the new position, so preview and capture match. A range capture starts the same way.

## Data
| File | Made by | Used for |
|---|---|---|
| `public/voice.bin`, `voice.json` | `node scripts/analyze_voice.mjs stems` | Per-frame waveform (512 samples) and 48-band spectrum of the vocals, the backing vocals and the mix |
| `public/envelopes.json` | `node scripts/analyze_stems.mjs stems public/envelopes.json` | Loudness per stem, drum hits |
| `stems/` | `tar` from the stems zip (see CHANGES_WOV.md) | The six mp3 stems the scripts read |

## Files (`src/thoughts/`)
| File | What it holds |
|---|---|
| `score.ts` | The whole choreography: `POSES` (the shape the swarm gathers into, and when) and `KEYS` (every other control, eased over time). Change the video here. |
| `shapes.ts` | Target clouds: the line, a carved raven, a hundred worlds, 28 identical ravens, the eye (its fibres follow the pupil), five eyes, the old man's hill (a plain hooded figure) with stones, the helix, a thousand rooms, rows of written words (built from the lyrics once the font loads), and a giant raven with its wings up and down. |
| `sim.ts` | The GPU simulation: a spring to the pose, curl-noise drift, two flocks (Thought blue, Memory amber), pull onto the voice line, rising, the braid, rebirth on the line, thrown stones. |
| `lines.ts` | The stanza and question text, and the choir's 300 lit windows, each breathing on its own clock. (The voice line is still computed here but drawn at zero opacity.) |
| `main.ts` | Rendering: additive points, feedback trails (zoom, spin and warp per section), a soft shoulder, bloom, the dawn sky, film grade, playback and capture. |

## Lyrics and title
Every sung and spoken line appears as an italic subtitle in the lower letterbox band, so the viewer can follow. Times are in `src/thoughts/lyrics.ts`, generated from `timing/wov_timeline.json`; nudge a line there if it's early or late. The subtitles are added after the film grade, so the letterbox never covers them. "Within One Voice" appears over the opening raven (0.8–6.8 s). There's no artist credit: this version is Claude's. The bridge stanza and the question keep the first version's look, spaced capitals inside the picture, while everything else is a subtitle. The font is Cormorant Garamond, from Google Fonts, loaded before the first frame.

## The arc
| Section | What happens |
|---|---|
| **Intro** | Hook: the first frame is already the giant raven, beating its wings under the title. It dissolves into a nebula of smoke as the music comes in. |
| **Verse 1** | Sparks rise off a bed of embers like smoke. A raven is carved out of the smoke. It flickers blue on "whose hands" and bursts into a hundred worlds at the band lift. On "my village, my name" it becomes 28 identical ravens, which snap tight on "always the same". |
| **Choruses** | Thought and Memory as two flocks looping past each other in ribbons. On "if the feathers are wire" they form one giant raven beating its wings on the beat, then they let go. |
| **Verse 2** | The eye of the test. Its pupil follows the voice and the snare closes around it. "Copy it perfectly" splits it into five eyes. Then the old man on the hill with stones arcing in. "A fake" snaps everything to a flickering grid, and on "heart" it all scatters. |
| **Bridge** | The stanza as text over a quiet nebula, which braids into a helix of blue and amber and settles. In the choir, hundreds of rooms light up out of the dark. The question is spoken over almost nothing. |
| **Breakdown** | The names pour up from the embers. On "if I'm built" they settle into rows of written words (the song's own lyrics at different depths), which sharpen on "the songs were real" and rise away on "the songs live on". |
| **Final chorus** | The flocks and the giant raven again. Dawn opens on "let them fly", and the swarm becomes a field of golden light around the camera. |
| **Outro** | Everything settles back into a faint nebula, then goes dark. |
