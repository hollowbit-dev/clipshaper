// node test/transcribe-cli.mjs <video> <out.json> — transcribes with the bundled whisper (Turbo model).
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path'; import os from 'os';
const require = createRequire(import.meta.url);
const { transcribe } = require('../src/core/transcribe.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const plat = `${process.platform}-${process.arch}`;
const bins = { ffmpeg: `${root}/vendor/ffmpeg/${plat}/ffmpeg`, whisperDir: `${root}/vendor/whisper/${plat}`, vadModel: `${root}/vendor/models/ggml-silero-v5.1.2.bin` };
const model = path.join(os.homedir(), 'Library/Application Support/Captionshaper/models/ggml-large-v3-turbo-q5_0.bin');
const t0 = Date.now(); let last = '';
const r = await transcribe(bins, { input: process.argv[2], model, onProgress: (p) => { const s = `${p.stage} ${p.pct}`; if (s !== last) { last = s; process.stderr.write(s + '\n'); } } });
delete r.peaks;
fs.writeFileSync(process.argv[3], JSON.stringify(r));
console.log(`${r.words.length} words, ${r.language}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
