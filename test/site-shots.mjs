// Screenshots of the website (serve docs/ at http://localhost:8791/clipshaper/ first).
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const out = path.resolve('test/out/site'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
for (const [name, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  for (const page of ['', 'download.html', 'faq.html', 'privacy.html']) {
    await p.goto(`http://localhost:8791/clipshaper/${page}`);
    await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
    await p.waitForTimeout(page ? 900 : 6500);
    await p.screenshot({ path: `${out}/${name}-${page.replace('.html', '') || 'home'}.png`, fullPage: !!page || name === 'mobile' });
  }
  if (errs.length) console.log(name, errs);
}
await b.close(); console.log('ok');
