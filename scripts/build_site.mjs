// Assembles the public site (GitHub Pages) in site/: the built player as index.html, player.js,
// and the media it fetches at runtime. Run after `npx vite build` (or use `npm run build:site`).
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from, to, required = true) => {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    if (required) throw new Error(`missing ${from}`);
    console.log(`(skip) ${from}`);
    return;
  }
  copyFileSync(src, resolve(out, to));
  console.log(`${from} -> site/${to}`);
};

copy('dist-player/player.html', 'index.html');
copy('dist-player/player.js', 'player.js');
copy('public/song.mp3', 'song.mp3');
copy('public/envelopes.json', 'envelopes.json', false);
copy('public/voice.json', 'voice.json', false);
copy('public/voice.bin', 'voice.bin', false);
copy('public/og.jpg', 'og.jpg', false);
copy('.nojekyll', '.nojekyll', false);
