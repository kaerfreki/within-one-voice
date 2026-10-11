import { defineConfig, type Plugin } from 'vite';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Capture mode (?capture) POSTs every rendered frame here as a PNG.
// Frames land in Electric Ravens\renders\dreams\<take>\f000000.png; encode them with ffmpeg.
const FRAMES_ROOT = resolve(__dirname, '..', 'renders', 'dreams');

function frameSink(): Plugin {
  return {
    name: 'frame-sink',
    configureServer(server) {
      server.middlewares.use('/__frame', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const take = (url.searchParams.get('take') ?? 'take').replace(/[^\w-]/g, '');
        const n = Number(url.searchParams.get('n') ?? 0);
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(FRAMES_ROOT, take);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `f${String(n).padStart(6, '0')}.png`), Buffer.concat(chunks));
          res.statusCode = 204;
          res.end();
        });
      });

      // Raw capture: frames arrive in order as RGBA pixels (bottom row first) and are piped straight into ffmpeg.
      // /__raw/start?take=&w=&h=&fps=  then POST /__raw/frame for each frame, then /__raw/end.
      // Writes renders/dreams/<take>.mp4 (video only; mux the song afterwards). Nothing piles up in the browser or on disk.
      let enc: ChildProcess | null = null;
      server.middlewares.use('/__raw', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const fail = (msg: string) => {
          res.statusCode = 500;
          res.end(msg);
        };
        if (url.pathname === '/start') {
          enc?.stdin?.end();
          const take = (url.searchParams.get('take') ?? 'take').replace(/[^\w-]/g, '');
          const w = Number(url.searchParams.get('w'));
          const h = Number(url.searchParams.get('h'));
          const fps = Number(url.searchParams.get('fps') ?? 24);
          mkdirSync(FRAMES_ROOT, { recursive: true });
          const out = resolve(FRAMES_ROOT, `${take}_video.mp4`);
          enc = spawn(process.env.FFMPEG ?? 'ffmpeg', [
            '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
            '-vf', 'vflip', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', out,
          ]);
          enc.stderr?.on('data', (d: Buffer) => console.error(`[ffmpeg] ${d}`));
          enc.on('error', (e) => console.error(`[ffmpeg] ${e.message}`));
          res.end(out);
          return;
        }
        if (url.pathname === '/end') {
          const p = enc;
          enc = null;
          if (!p) return fail('no capture running');
          p.on('close', (code) => res.end(`ffmpeg exited ${code}`));
          p.stdin?.end();
          return;
        }
        if (url.pathname === '/frame') {
          if (!enc?.stdin) return fail('no capture running');
          const stdin = enc.stdin;
          req.on('data', (c: Buffer) => {
            // Respect backpressure so a slow encoder doesn't buffer gigabytes
            if (!stdin.write(c)) {
              req.pause();
              stdin.once('drain', () => req.resume());
            }
          });
          req.on('end', () => {
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        fail('unknown');
      });
    },
  };
}

export default defineConfig({
  plugins: [frameSink()],
  server: { port: 5183 },
  // `npx vite build` makes the shareable player: dist-player/player.js (plus player.html). The song and
  // envelopes.json are copied next to it by scripts/publish_player.ps1; public/ (with the 500 MB stems) is not copied.
  base: './',
  build: {
    outDir: 'dist-player',
    emptyOutDir: true,
    copyPublicDir: false,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: resolve(__dirname, 'player.html'),
      output: { entryFileNames: 'player.js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' },
    },
  },
});
