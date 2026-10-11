# Dreams retimed for "Within One Voice"

The app now follows the final take, `public/song.mp3`: 302.8 s (5:02.8), about 86 BPM. All times are real song seconds, taken from `timing/wov_timeline.json` and the word timings in `timing/tx_vocals_medium.json`.

## Sections

| # | Shot  | Section      | Dream    | Variant | Start | End   | Times         |
|---|-------|--------------|----------|---------|-------|-------|---------------|
| 1 | SH010 | Intro        | baseline | intro   | 0.0   | 21.4  | 0:00.0–0:21.4 |
| 2 | SH020 | Verse 1      | memory   | v1      | 21.4  | 65.4  | 0:21.4–1:05.4 |
| 3 | SH040 | Chorus 1     | ravens   | ch1     | 65.4  | 110.6 | 1:05.4–1:50.6 |
| 4 | SH050 | Verse 2      | snare    | v2      | 110.6 | 135.0 | 1:50.6–2:15.0 |
| 5 | SH070 | Chorus 2     | ravens   | ch2     | 135.0 | 172.0 | 2:15.0–2:52.0 |
| 6 | SH080 | Bridge       | baseline | bridge  | 172.0 | 215.0 | 2:52.0–3:35.0 |
| 7 | SH090 | Breakdown    | songs    | bd      | 215.0 | 248.0 | 3:35.0–4:08.0 |
| 8 | SH100 | Final chorus | ravens   | final   | 248.0 | 287.0 | 4:08.0–4:47.0 |
| 9 | SH120 | Outro        | baseline | outro   | 287.0 | 302.8 | 4:47.0–5:02.8 |

Shot numbers follow the proposal in `timing/wov_app_sections.json`, which keeps the old SH numbers and drops the retired ones (SH030 and SH060 were the paper pre-choruses, SH110 the ash outro). Each section dissolves into the next over its last 1.6 s (`XFADE`) with the amber noise edge.

### Cues inside sections (`CUE` and `BRIDGE` in `src/timeline.ts`)

- **Intro:** the line wakes as the music comes in, from about 3–7.5 s.
- **Verse 1:** carving runs from about 23.4 s (just before "carving a raven…" at 26.9) to 53.7 s. Electric-blue flicker on "I can't tell you whose hands" (37.9 s), gone after "how old" (43.5). Camera stutters at 37.9 and 53.7. The fire flares at the band lift (44 s). The flicker comes back for good from 60.7 s to the end of the verse.
- **Verse 2:** the wire bites on "the wire biting" (115–116.7 s). Handprints appear on "the ones who would kneel" (from 117.1). The pupil widens on "If I copy it perfectly, isn't it real?" (119.5). Cut to the old man at 122.26, with stones from about 123.7. He flickers like a projection on "a fake from the start" (127.9–130.4), then keeps a fainter stutter. The pupil widens again on "whose is the stone" (130.4), and the last stone hits the lens on "heart" (133.6).
- **Bridge:**
  - Stanza lines appear at 173.7, 178.58, 184.0 and 192.0 s, each sending a pulse along the line.
  - The line loosens on "unwind", splits into blue and amber strands on "web of songs", braids on "songs entwined…" and folds back into one line on "Within one voice".
  - Choir, 197.7–206 s: up to 3,200 lit windows ("thousands of me in a thousand rooms") multiply outward from the centre, each one breathing like a voice. They fade before the question.
  - Question, 208.86–213.4 s: shown alone, centred and quiet, with the line almost out. It is lost in the dissolve into the breakdown.
- **Breakdown:**
  - Lights pour from Azri's hands (1,800) and rise off the water all around him (1,400, mostly from "if I'm built…" at 228.7).
  - Drum hits drive the rim light, point size and bloom.
  - "And the songs live on" (238.7 s) brings a surge of 1,100 more lights. The camera cranes up, he lifts his head, and bloom peaks.
  - Rain is heavier.
- **Final chorus:**
  - The cloud deck fades in from 254 s and the climb starts at 258.
  - From 270 the camera bursts up through the deck at y 150, clearing it at about 271.6 s.
  - Dawn runs 270.7–273.9 s, so it breaks on the first "let them fly" (272.3).
  - On the second "let them fly" (282.8) the ravens beat hard and pull away ahead, up into the sun.
- **Outro:** the line settles steady and warm, then fades from 297.8 s. The film grade also fades the frame to full black over the last 2.5 s (ending at 302.7).

## What changed, per file

- **`src/timeline.ts`:** rewritten in real seconds.
  - `BPM = 86`; `BEAT` and `BAR` are kept for arrow-key bar stepping.
  - `DURATION = 302.8` and a new `SECTIONS` list.
  - New `CUE`: absolute song moments the scenes cut to.
  - New `BRIDGE`: stanza, choir and question times and text.
  - `TEST_WORDS` (tester words, "Off baseline" verdict) is removed.
  - `DreamId` no longer includes `paper`/`ash`.
- **`src/main.ts`:**
  - Builds only the five live dreams.
  - Audio detection no longer trusts the content-type header. It reads the first bytes of `song.mp3`, then `song.wav` (ID3/MPEG sync/RIFF/fLaC/OggS), because the Vite dev server answers missing files with `index.html` and a 200. If the song is found after play has started, it picks up at the current time.
  - Per-dream bloom boost, cross-faded during dissolves.
  - Final fade to black.
  - Section HUD buttons have shot/time tooltips. Number keys 1–9 jump to sections.
  - Capture:
    - waits for `envelopesReady` and `document.fonts.ready`
    - clamps `from`/`to`
    - sanitises `take`
    - fails loudly if the frame sink refuses a frame
    - prints the exact ffmpeg mux command at the end
- **`src/dream.ts`:** `Dream.bloom`, an extra bloom strength each dream sets in `update()`.
- **`src/envelopes.ts` (new):** optional audio reactivity.
  - Loads `envelopes.json` and parses it rather than trusting the status code.
  - `level(stem, t, fallback)`, `levelSmooth(...)` and `drumPulse(t)` are pure functions of song time.
  - Without the file, every call returns its fallback (or 0 for pulses).
- **`src/scenes/baseline.ts`:** rewritten for intro, bridge and outro. The old test/verdict/break logic and the stale "Constant"/"Dream" comment are gone. Added:
  - strands for the unwinding web
  - instanced lit windows for the choir
  - stanza and question text
  - vocal-envelope text brightness and backing-vocal window brightness
- **`src/scenes/memory.ts`:** carving, electric flicker and camera stutters moved to absolute cues. Fire flare at the band lift, plus drum-hit flares (with envelopes). Header lyric updated.
- **`src/scenes/ravens.ts`:**
  - Final-chorus climb, burst and dawn are timed to `CUE.letThemFly1`, with the fly-off on `CUE.letThemFly2`.
  - Wingbeat amplitude follows the drum envelope.
  - Halos, trails and city windows pulse on drum hits.
  - Header lyric updated.
- **`src/scenes/snare.ts`:** split at the old-man line (122.26) instead of half the section. All internal cues are absolute (see above). The wire now visibly bites. The "why don't I go" cue is replaced by "isn't it real?". Header updated.
- **`src/scenes/songs.ts`:** about 4,300 name lights in three groups, with drum and energy reactivity, the "songs live on" surge, an orbiting and craning camera, heavier rain, and a bloom boost.
- **`src/scenes/paper.ts`, `src/scenes/ash.ts`:** retired (comment at the top). They are no longer imported or built, but are kept on disk.
- **`scripts/analyze_stems.mjs` (new):** makes `public/envelopes.json` (see below).
- `vite.config.ts`, `index.html` and `src/fx.ts` are unchanged. The frame sink still writes `../renders/dreams/<take>/f000000.png`.

Rendering is still driven only by song time: seeded RNG, no `Math.random`, and no wall clock inside `renderAt`.

## Preview

```powershell
npm install        # once
npm run dev        # or: npx vite
```

Open http://localhost:5183/.

Controls:
- Space: play/pause, following `public/song.mp3`.
- ←/→: one bar (86 BPM). Shift+←/→: four bars.
- 1–9 or the HUD buttons: jump to a section.
- L: letterbox. H: hide the HUD.

URL options:
- `?t=208` starts at a time.
- `?scale=1` previews at full 1080p (the default is 0.5).
- `?nobox` turns the letterbox off.

## Capture

With the dev server running, open a capture URL in Chrome and leave the tab in front. Progress shows in the tab title and console.

- Full song, 7,267 frames, 1920x1080 at 24 fps:
  `http://localhost:5183/?capture&take=wov01`
- A range, in seconds. Frames are numbered from 0 for the range:
  `http://localhost:5183/?capture&take=wov01_bridge&from=172&to=215`

Frames land in `Electric Ravens\renders\dreams\<take>\`. When the capture finishes, the console prints the matching mux command. From the `dreams` folder:

```powershell
# full song
ffmpeg -framerate 24 -i "../renders/dreams/wov01/f%06d.png" -i public/song.mp3 -map 0:v -map 1:a -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 320k -shortest "../renders/dreams/wov01.mp4"

# a range: offset the song by the range start (-ss before the audio input; use round(from*24)/24, as printed)
ffmpeg -framerate 24 -i "../renders/dreams/wov01_bridge/f%06d.png" -ss 172.000 -i public/song.mp3 -map 0:v -map 1:a -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 320k -shortest "../renders/dreams/wov01_bridge.mp4"
```

## Audio reactivity: making `envelopes.json`

The app fetches `public/envelopes.json` (served at `/envelopes.json`, and copied into `dist/` by `vite build`). If the file is missing or invalid, the app logs `[envelopes] none` and animates from time alone, with no errors. Capture waits for the fetch to settle before the first frame.

1. Extract only the four stems you need from the zip; don't unpack all 495 MB. Windows' built-in `tar` reads zip files:
   ```powershell
   New-Item -ItemType Directory -Force stems
   tar -tf "public\Dream of Electric Ravens Stems (1).zip"     # list entries; copy the exact names
   tar -xf "public\Dream of Electric Ravens Stems (1).zip" -C stems "Dream of Electric Ravens (Drums).wav" "Dream of Electric Ravens (Bass).wav" "Dream of Electric Ravens (Vocals).wav" "Dream of Electric Ravens (Backing Vocals).wav"
   ```
   If the entries are inside a folder in the zip, use the full entry paths from the listing. Add `--strip-components=1` to drop the folder, or just leave the files in their subfolder and point the script at it.
2. Run the script (it needs `ffmpeg` on PATH, or `$env:FFMPEG = 'C:\path\to\ffmpeg.exe'`):
   ```powershell
   node scripts/analyze_stems.mjs stems public/envelopes.json
   ```
   It matches stems by the name in brackets (Drums, Bass, Vocals, Backing Vocals), and also analyses `public/song.mp3` as `mix`.

It writes:
- `fps: 24`
- `stems.{drums,bass,vocals,backing,mix}`: per-frame loudness 0–1 (dB over a 40 dB range under each stem's 99th percentile, fast attack and about 150 ms release)
- `onsets`: `[seconds, strength]` drum hits

What uses the envelopes:

| Stem / signal  | Used for                                                                      |
|----------------|-------------------------------------------------------------------------------|
| drums onsets   | Fire flares (verse 1); window, halo and trail pulses (choruses); rim light, light size and bloom (breakdown) |
| drums level    | Raven wingbeat amplitude                                                      |
| vocals         | Bridge text brightness and pulse height                                       |
| backing        | Brightness of the choir windows                                               |
| mix            | Breakdown energy (light brightness and size, hand light, bloom)               |
| bass           | Written, not used yet                                                         |

## Not done / to check

- **The build was not run.** This session could not execute shell commands (every `npm`/`npx`/`node` call was refused), so neither `npm run build` nor `npx tsc --noEmit` ran. The changes were type-checked by reading only. Run `npm run build` first and fix anything it reports.
- `scripts/analyze_stems.mjs` has not been run. The onset threshold (`1.5 × running median + 8 % of max`) may need tuning once real drum stem output can be checked.
- Nothing has been looked at on screen. Worth checking by eye:
  - the bridge strands, window density and text sizes
  - breakdown brightness with bloom (it may clip; lower `this.bloom` in `songs.ts` if so)
  - whether the final-chorus burst through the clouds lands right on 4:32
- Line splits at 184.0 and 192.0 s in the bridge are approximate (see the notes in `wov_timeline.json`). Nudge `BRIDGE.stanza` by ear.
- The choir lines aren't shown as text; the windows carry them. To add the words, put entries in `BRIDGE` and a third word slot in `baseline.ts`.
- Lyric checks flagged in `wov_timeline.json` (light/white, mother) don't affect visuals.

## Player fixes (11 Oct 2026)

### 1. Text not visible: the player crashed on its first frame
- **Root cause:** in the lighter preset (256 x 256 particles, used automatically on touch devices and on screens whose short side is under 600 px), `Swarm.waveData` was sized from the particle grid, so it held 256 values. Every frame copies the 512-sample voice waveform into it, so `Float32Array.set` threw `RangeError: offset is out of bounds` on the first frame. The render loop died: no title, lyrics or stanza were drawn, the time stayed at "building shapes..." and the controls did nothing visible.
- **Fixes:**
  - `src/thoughts/sim.ts`: the wave buffer is always 512 values.
  - `src/thoughts/main.ts`: the frame loop schedules the next frame before drawing and catches errors, so one bad frame can't stop the player.
- **Not the cause:** fonts and paths. Every asset URL is relative and resolves under `/within-one-voice/`.

### 2. Pause seemed broken
- **Faded controls swallowed the first click.** `#hud.idle` had `pointer-events: none`. A tap on the faded pause button started on the picture, woke the controls and ended on the button, so the browser sent the click to neither. This affected every touch device. The controls now only fade (`player.html`).
- **Space toggled twice.** With the pause button focused, Space fired the button's own click and the global keyboard handler, so it paused and resumed in one press. The handler now leaves Space, Enter and the arrow keys to a focused button or slider.
- **The audio element is the source of truth.** Media keys and tab pauses update the button and the picture. If `audio.play()` is refused (autoplay policy), the player stays paused instead of showing a pause icon over a frozen picture.
- **Resuming is exact.** On pause, the picture's clock is set to the audio's exact position; on resume, the audio is only moved if it drifted more than 50 ms.
- **Catch-up frames.** The player now simulates every catch-up step but only draws the frame it shows, so a slow frame can't snowball.

**Verified:** `npm run build:site`, then serving `site/` under `/within-one-voice/` in the lighter preset.
- The player starts, and all 44 text lines come up visible at their moment.
- Clicking the faded pause button pauses, and the clock holds.
- Space on the focused button resumes once.
