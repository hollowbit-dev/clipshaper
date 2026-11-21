// node test/moments-cli.mjs test/cache/x.json [standard|best] — runs the moment finder on a cached transcript.
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url);
const llm = require('../src/core/llm.js'); const M = require('../src/core/moments.js');
const tr = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const file = path.join(os.homedir(), 'Library/Application Support/Writeshaper/models', process.argv[3] === 'best' ? 'Qwen3.5-4B-Q4_K_M.gguf' : 'Qwen3.5-4B-UD-IQ3_XXS.gguf');
const t0 = Date.now();
await llm.start({ isPackaged: false }, file);
const t1 = Date.now();
const r = await M.find(tr.words, { duration: tr.duration, ask: llm.ask, onProgress: (p) => process.stderr.write(`${p}% `) });
llm.stop();
console.log(`\nload ${(t1 - t0) / 1000}s, find ${(Date.now() - t1) / 1000}s, ${r.sentences.length} sentences, method ${r.method}`);
for (const c of r.clips) {
  const text = r.sentences.slice(c.from, c.to + 1).map((s) => s.text).join(' ');
  console.log(`\n[${c.score}] ${c.title}  (${(c.start / 60 | 0)}:${String(Math.round(c.start % 60)).padStart(2, '0')}, ${Math.round(c.end - c.start)}s)\n   ${text.slice(0, 220)}${text.length > 220 ? '…' : ''}`);
}
fs.writeFileSync(process.argv[2].replace('.json', '.clips.json'), JSON.stringify(r.clips));
