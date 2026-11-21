// End to end in the real app: open a video (transcript + picks from test/cache), wait for faces,
// screenshot the clips screen, export the first clip, check the file.
import { _electron as electron } from 'playwright';
import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const video = process.argv[2] || path.join(os.homedir(), 'Downloads/fan-favorite-moments-from-the-good-place-chosen-by-you-ytshorts.savetube.vip.mp4');
const out = path.join(root, 'test/out'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'clipshaper-test-'));
const app = await electron.launch({ ...(process.env.EXE ? { executablePath: process.env.EXE, args: [] } : { args: [root] }), env: { ...process.env, CLIPSHAPER_TEST: '1', CLIPSHAPER_USERDATA: data, ...(process.env.NOCACHE ? {} : { CLIPSHAPER_CACHE: path.join(root, 'test/cache') }), CLIPSHAPER_OUTDIR: out } });
const win = await app.firstWindow();
const logs = []; win.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`)); win.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
let fails = 0; const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const poll = async (fn, ms = 60000) => { const end = Date.now() + ms; for (;;) { const v = await win.evaluate(fn).catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 300)); } };
await win.setViewportSize?.({ width: 1320, height: 860 });
await poll(() => document.querySelector('.home'), 15000);
await win.screenshot({ path: `${out}/home.png` });
await win.evaluate((v) => window.__cs.openVideo(v), video);
const t0 = Date.now();
check(await poll(() => document.querySelectorAll('.clip-card').length, 600000), 'clips screen shows clips');
console.log(`  analysis + faces: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const info = await win.evaluate(() => window.__cs.current.project.clips.map((c) => ({ title: c.title, keys: c.keys && c.keys.length, faces: c.faceShare })));
console.log(info.map((c) => `  ${c.title}: keys ${c.keys}, faces ${Math.round((c.faces || 0) * 100)}%`).join('\n'));
check(info.every((c) => c.keys), 'every clip has a face path');
await new Promise((r) => setTimeout(r, 2500));
await win.screenshot({ path: `${out}/clips.png` });
// play a moment of the preview
await win.evaluate(() => document.querySelector('#pp').click()); await new Promise((r) => setTimeout(r, 2200));
await win.evaluate(() => document.querySelector('#pp').click());
await win.screenshot({ path: `${out}/playing.png` });
await win.evaluate(() => window.__cs.exportClips([window.__cs.current.project.clips[0]]));
const files = fs.readdirSync(out).filter((f) => f.endsWith('.mp4'));
check(files.length === 1, `exported ${files.join(', ')}`);
await app.close();
if (logs.some((l) => /error/i.test(l))) console.log(logs.filter((l) => /error/i.test(l)).join('\n'));
fs.rmSync(data, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
