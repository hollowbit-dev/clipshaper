import { chromium } from 'playwright'; import fs from 'fs';
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.setContent(`<html><body style="margin:0;background:transparent">${fs.readFileSync(new URL('./icon.svg', import.meta.url), 'utf8')}</body></html>`);
await p.locator('svg').screenshot({ path: new URL('../icon.png', import.meta.url).pathname, omitBackground: true });
await b.close();
