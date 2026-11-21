// Frame rate of the home page while scrolling and while the demo runs, with the CPU slowed 4x.
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await p.goto('http://localhost:8791/clipshaper/');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const fps = (ms, action) => p.evaluate(async ([ms, action]) => {
  let n = 0; let worst = 0; let last = performance.now(); const end = last + ms;
  const scroll = action === 'scroll';
  await new Promise((res) => { const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (scroll) window.scrollBy(0, 12); if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  return `${Math.round(n / (ms / 1000))} fps, worst frame ${Math.round(worst)} ms`;
}, [ms, action]);
await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(1500);
console.log('demo running:', await fps(4000, 'idle'));
await p.evaluate(() => window.scrollTo(0, 0));
console.log('scrolling:   ', await fps(5000, 'scroll'));
await b.close();
