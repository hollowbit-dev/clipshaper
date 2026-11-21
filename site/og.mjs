// Renders the 1200x630 share image (site/assets/img/og.png).
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const here = path.dirname(new URL(import.meta.url).pathname);
const icon = fs.readFileSync(path.join(here, '..', 'assets/icon.png')).toString('base64');
const font = fs.readFileSync(path.join(here, 'assets/fonts/Geist-Variable.woff2')).toString('base64');
const html = `<html><head><style>
@font-face { font-family: G; src: url(data:font/woff2;base64,${font}); font-weight: 100 900; }
body { margin: 0; width: 1200px; height: 630px; background: #0c0e13; font-family: G; color: #f1f4f8; overflow: hidden; position: relative; }
.glow { position: absolute; width: 900px; height: 900px; right: -260px; top: -300px; border-radius: 50%; background: radial-gradient(circle, rgba(34,211,238,.28), transparent 62%); }
.in { position: absolute; left: 72px; top: 72px; right: 72px; bottom: 72px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; letter-spacing: -.02em; }
.brand img { width: 72px; height: 72px; margin: -6px; }
h1 { font-size: 92px; line-height: .98; letter-spacing: -.05em; margin: auto 0 20px; font-weight: 760; }
h1 em { font-style: normal; background: linear-gradient(120deg, #8ef0ff, #22d3ee 45%, #3b6ff2); -webkit-background-clip: text; color: transparent; }
p { margin: 0; font-size: 28px; color: #a9b1bd; letter-spacing: -.01em; }
.phones { position: absolute; right: 72px; top: 150px; display: flex; gap: 18px; }
.ph { width: 120px; height: 213px; border-radius: 18px; box-shadow: 0 0 0 1.5px rgba(255,255,255,.12), 0 30px 60px rgba(0,0,0,.5); display: grid; place-items: end center; padding-bottom: 60px; box-sizing: border-box; font-weight: 900; font-size: 15px; text-transform: uppercase; text-align: center; }
.ph:nth-child(2) { margin-top: -30px; }
.ph b { background: #c6ff3d; color: #08090a; padding: 0 4px; border-radius: 3px; }
</style></head><body><div class="glow"></div>
<div class="phones"><div class="ph" style="background:linear-gradient(160deg,#2a3550,#141a28)"><span>Nobody <b>tells</b><br>you this</span></div><div class="ph" style="background:linear-gradient(160deg,#3d2a3f,#1a1420)"><span>I quit on<br>a <b style="background:#ffd23f">Tuesday</b></span></div><div class="ph" style="background:linear-gradient(160deg,#1f3a35,#101c1a)"><span>The <b style="background:#3fdcf5">one</b> rule</span></div></div>
<div class="in"><div class="brand"><img src="data:image/png;base64,${icon}">Clipshaper</div>
<h1>Long video in.<br><em>Short clips out.</em></h1><p>Free AI clips with captions. No watermark. Nothing uploaded.</p></div></body></html>`;
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: path.join(here, 'assets/img/og.png') }); await b.close(); console.log('og.png');
