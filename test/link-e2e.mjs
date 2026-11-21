// Paste a link in the real app and wait for clips. node test/link-e2e.mjs <url>
import { _electron as electron } from 'playwright';
import fs from 'fs'; import path from 'path'; import os from 'os';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const url = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const out = path.join(root, 'test/out'); fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'clipshaper-test-'));
// reuse the downloaded models from the real data folder
const app = await electron.launch({ args: [root], env: { ...process.env, CLIPSHAPER_TEST: '1', CLIPSHAPER_USERDATA: data } });
const win = await app.firstWindow();
const logs = []; win.on('pageerror', (e) => logs.push(e.message));
const poll = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = await win.evaluate(fn).catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 400)); } };
await poll(() => document.querySelector('#link-form'), 15000);
await win.screenshot({ path: `${out}/home-link.png` });
await win.fill('#link', url); await win.click('#link-go');
await poll(() => document.querySelector('.stages li[data-stage="fetch"]'), 5000);
const t0 = Date.now(); let shot = false;
const r = await poll(async () => {
  if (!window.__shot && document.querySelector('.stages li[data-stage="listen"].on')) { window.__shot = 1; return null; }
  return document.querySelector('.clip-card') ? 'clips' : document.querySelector('.home') && document.querySelector('.toast') ? 'error: ' + document.querySelector('.toast').innerText.replace(/\n/g, ' / ') : null;
}, 1200000);
console.log(r, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
await win.screenshot({ path: `${out}/link-result.png` });
console.log(logs.join('\n'));
await app.close(); fs.rmSync(data, { recursive: true, force: true });
