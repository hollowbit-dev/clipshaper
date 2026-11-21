// node test/links.mjs [url] — installs yt-dlp into a temp folder and downloads one video.
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url);
const { createLinks, looksLikeLink } = require('../src/core/links.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.env.LINKS_DIR || path.join(os.tmpdir(), 'clipshaper-links-test');
const L = createLinks({ dir: path.join(dir, 'bin'), ffmpeg: `${root}/vendor/ffmpeg/${process.platform}-${process.arch}/ffmpeg` });
console.log('looksLikeLink', looksLikeLink('https://youtu.be/x'), looksLikeLink('hello'), looksLikeLink('/Users/a.mp4'));
const url = process.argv[2] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const t0 = Date.now(); let last = '';
const r = await L.download(url, { outDir: path.join(dir, 'dl'), onProgress: (p) => { const s = `${p.stage} ${Math.floor(p.pct / 10) * 10}`; if (s !== last) { last = s; process.stdout.write(s + ' | '); } } });
console.log(`\n${r.title}\n${r.file}\n${(fs.statSync(r.file).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
