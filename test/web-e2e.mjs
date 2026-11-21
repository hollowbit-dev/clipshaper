// The web version end to end in real Chrome: pick a video, wait for clips, export one.
// Serve docs/ at http://localhost:8791/clipshaper/ first. node test/web-e2e.mjs [video]
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import os from 'os';
const video = process.argv[2] || path.join(os.homedir(), 'Downloads/pay-it-forward-55-burgers-55-fries-gb-702893-my-dub.mp4');
const out = path.resolve('test/out/web'); fs.mkdirSync(out, { recursive: true });
const profile = process.env.PROFILE || '/private/tmp/claude-501/-Users-elviszygmanta/c52442bc-f848-47a1-8659-e0930fa460c2/scratchpad/chrome-profile';
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1320, height: 860 }, acceptDownloads: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await ctx.newPage();
const logs = []; p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); }); p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
let fails = 0; const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
await p.goto(process.env.URL || 'http://localhost:8791/clipshaper/try/');
await p.waitForSelector('.home', { timeout: 20000 });
await p.screenshot({ path: `${out}/home.png` });
const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#drop')]);
await chooser.setFiles(video);
const t0 = Date.now(); let lastNote = '';
const timer = setInterval(async () => { const n = await p.evaluate(() => [...document.querySelectorAll('.stages li.on')].map((li) => li.innerText.replace(/\n/g, ' ')).join('')).catch(() => ''); if (n && n !== lastNote) { lastNote = n; console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s ${n}`); } }, 2000);
const r = await p.waitForFunction(() => document.querySelector('.clip-card') ? 'clips' : (document.querySelector('.home') && document.querySelector('.toast')) ? 'error: ' + document.querySelector('.toast').innerText : null, null, { timeout: 1800000, polling: 1000 });
clearInterval(timer);
const res = await r.jsonValue();
check(res === 'clips', `analysis: ${res} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (res === 'clips') {
  await p.waitForTimeout(3000);
  const info = await p.evaluate(() => window.__cs.current.project.clips.map((c) => `${c.score} ${c.title} (${Math.round(c.end - c.start)}s) keys:${c.keys ? c.keys.length : 0}`));
  console.log(info.map((x) => '  ' + x).join('\n'));
  console.log('  method:', await p.evaluate(() => window.__cs.current.project.method));
  await p.screenshot({ path: `${out}/clips.png` });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 300000 }), p.click('#export-one')]);
  const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f);
  check(fs.statSync(f).size > 100000, `exported ${dl.suggestedFilename()} ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
}
await ctx.close();
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
