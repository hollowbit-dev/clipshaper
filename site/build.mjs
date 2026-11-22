// Builds the Clipshaper website into docs/ (GitHub Pages, served at hollowbit.dev/clipshaper).
// Pages: home (with the animated demo), try/ (the full app, running in the browser), download,
// FAQ, privacy, 404, plus sitemap, robots and llms.txt. English for now.
// Run: npm run site
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { studioPill, studioBadge, studioCard, studioCss } from './studio.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const out = path.join(root, 'docs');
const V = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const UPDATED = '2026-11-21';
const SITE = { url: 'https://hollowbit.dev/clipshaper', base: '/clipshaper/', github: 'https://github.com/hollowbit-dev/clipshaper', tip: 'https://ko-fi.com/hollowbit', studio: 'https://hollowbit.dev/' };
const FILES = { mac: `Clipshaper-${V}-mac-arm64.dmg`, win: `Clipshaper-Setup-${V}-win-x64.exe` };
const DL = `${SITE.github}/releases/latest/download/`;
const mb = (f) => { const p = path.join(root, 'dist', f); return fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1e6) : 150; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const B = SITE.base;

// ---------- icons ----------
const I = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  apple: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9C6.1 7 4.5 8 3.6 9.6c-1.8 3.2-.5 7.9 1.3 10.4.9 1.3 1.9 2.7 3.2 2.6 1.3 0 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4.6zM14 5.2c.7-.9 1.2-2 1-3.2-1 .1-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>',
  win: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M3 5.6 10.4 4.6v7H3zM11.6 4.4 21 3v8.6h-9.4zM3 12.6h7.4v7L3 18.6zM11.6 12.6H21V21l-9.4-1.4z"/></svg>',
  check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: I('<path d="M7 7l10 10M17 7 7 17"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  lock: I('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  spark: I('<path d="M12 3c.7 4.6 2.4 6.3 7 7-4.6.7-6.3 2.4-7 7-.7-4.6-2.4-6.3-7-7 4.6-.7 6.3-2.4 7-7z"/>'),
  face: I('<circle cx="12" cy="10" r="3.5"/><path d="M5.5 20c1-3 3.6-4.6 6.5-4.6s5.5 1.6 6.5 4.6"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>'),
  cc: I('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10 10a2.5 2.5 0 1 0 0 4M17 10a2.5 2.5 0 1 0 0 4"/>'),
  link: I('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  free: I('<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7.9-2.7 2s1 1.6 2.7 2 2.7.9 2.7 2-1.1 2-2.7 2c-1.2 0-2.2-.5-2.7-1.3M12 6.5V8m0 8v1.5"/>'),
  drop: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  cut: I('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 17M8 16.5 20 7"/>'),
  globe: I('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z"/>'),
  laptop: I('<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>'),
};

// ---------- shared layout ----------
function layout(page, title, desc, body, o = {}) {
  const canon = `${SITE.url}/${page === 'index' ? '' : `${page}.html`}`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Clipshaper', applicationCategory: 'MultimediaApplication',
    operatingSystem: 'macOS 12 or later, Windows 10, Windows 11, web browser', softwareVersion: V, description: desc,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, downloadUrl: `${SITE.url}/download.html`,
    publisher: { '@type': 'Organization', name: 'Hollowbit Studio', url: SITE.studio }, image: `${SITE.url}/img/og.png`,
  }, ...(o.ld || [])];
  const NAV = [['try/', 'Try it', 'try'], ['faq.html', 'FAQ', 'faq'], ['privacy.html', 'Privacy', 'privacy']];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Clipshaper by Hollowbit Studio"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canon}"><meta property="og:image" content="${SITE.url}/img/og.png"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#22d3ee">
<link rel="icon" href="${B}img/icon-64.png"><link rel="apple-touch-icon" href="${B}img/icon-256.png">
<link rel="preload" href="${B}fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${B}site.css?v=${o.cssv}">
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld)}</script>
</head>
<body class="p-${page}">
<div class="wash" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<header class="nav">
  <div class="nav-in glass">
    <a class="logo" href="${B}"><img src="${B}img/icon-64.png" width="28" height="28" alt=""><span>Clipshaper</span></a>${studioPill('en')}
    <nav class="links" id="links">
      ${NAV.map(([h, txt, id]) => `<a href="${B}${h}"${page === id ? ' aria-current="page"' : ''}>${txt}</a>`).join('')}
      <a class="btn btn-brand sm" href="${B}download.html">Download</a>
    </nav>
    <button class="menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="links">${ICON.menu}</button>
  </div>
</header>
<main>
${body}
</main>
<footer class="foot">
  <div class="wrap">
    ${studioCard('en', 'Clipshaper')}
    <div class="foot-grid">
      <div class="foot-brand"><a class="logo" href="${B}"><img src="${B}img/icon-64.png" width="28" height="28" alt=""><span>Clipshaper</span></a><p>Free AI clip maker. Long video in, short vertical clips out, with captions. Your video is never uploaded.</p></div>
      <div><b>Product</b><a href="${B}try/">Try in your browser</a><a href="${B}download.html">Download</a><a href="${SITE.github}/releases">Changelog</a></div>
      <div><b>Help</b><a href="${B}faq.html">FAQ</a><a href="${B}privacy.html">Privacy</a><a href="${SITE.github}/issues">Report a problem</a><a href="https://discord.gg/ENSTjVpJj8" rel="noopener">Discord</a></div>
      <div><b>Hollowbit</b><a href="${SITE.studio}">Studio</a><a href="${SITE.github}">GitHub</a><a href="${SITE.tip}">Support us</a></div>
    </div>
    <div class="foot-mark" aria-hidden="true">Clipshaper</div>
    <p class="foot-small">Free and open source (GPL-3.0). Not affiliated with YouTube, TikTok, Instagram or any clip service.</p>
  </div>
</footer>
<script src="${B}site.js?v=${o.jsv}" defer></script>
</body>
</html>`;
}

const headline = (text) => {
  let i = 0;
  const parts = text.split(/(<em>.*?<\/em>|<br>)/).filter(Boolean).flatMap((p) => {
    if (p === '<br>') return ['<br>'];
    const em = p.startsWith('<em>'); const inner = em ? p.slice(4, -5) : p;
    return inner.split(' ').filter(Boolean).map((w) => `<span class="w" style="--i:${i++}">${em ? `<em>${w}</em>` : w}</span>`);
  });
  return `<h1 class="split">${parts.join(' ').replace(/ <br> /g, '<br>')}</h1>`;
};
const words = (text) => text.split(' ').map((w) => `<span>${esc(w)}</span>`).join(' ');
const dlButtons = (cls = 'cta') => `<div class="${cls}">
  <a class="btn btn-brand big" href="${B}try/">${ICON.spark}Try it free in your browser</a>
  <a class="btn btn-glass big" data-os="mac" href="${B}download.html#mac">${ICON.apple}Download for Mac</a>
  <a class="btn btn-glass big" data-os="win" href="${B}download.html#win">${ICON.win}Download for Windows</a>
</div>`;

// ---------- the hero demo (made-up podcast; people are simple shapes) ----------
const LINES = [
  ['0:00', "Hey, welcome back. Quick thanks to everyone who wrote in."],
  ['3:12', 'So today is a bit different, I want to talk about money.'],
  ['7:48', 'Nobody tells you the first year is the hardest part.'],
  ['8:05', "You're broke, you're tired, and it still feels like it's working."],
  ['15:30', 'Anyway, let me read a few of your questions.'],
  ['21:16', 'I quit my job on a Tuesday. I had no plan at all.'],
  ['33:40', 'Here is the one rule I wish I knew at twenty.'],
  ['41:02', "That's it for today. See you next week."],
];
const PICKS = [2, 5, 6];
const PHONES = [
  { cap: 'Nobody tells you this part', title: 'The first year', score: 9, shift: 18, hl: '#c6ff3d', bg: 'linear-gradient(160deg,#2a3550,#141a28)', p: ['#e9b48a', '#3b5bdb'], p2: ['#c58c6a', '#2b2f3a'] },
  { cap: 'I quit on a Tuesday', title: 'No plan at all', score: 10, shift: 2, hl: '#ffd23f', bg: 'linear-gradient(160deg,#3d2a3f,#1a1420)', p: ['#c98e6b', '#e8590c'], p2: ['#8a5a44', '#1f2a44'] },
  { cap: 'The one rule I wish I knew', title: 'One rule at twenty', score: 8, shift: -14, hl: '#3fdcf5', bg: 'linear-gradient(160deg,#1f3a35,#101c1a)', p: ['#f0c39e', '#2f9e44'], p2: ['#a8735a', '#5f3dc4'] },
];
const SEGS = [[17, 4], [49, 4], [75, 4]];
const person = (c, cls = '') => `<div class="person ${cls}"><div class="head" style="background:${c[0]}"></div><div class="body" style="background:${c[1]}"></div></div>`;
const demo = () => `
<div class="show reveal" data-picks="${PICKS.join(',').replace(/^/, '[').replace(/$/, ']')}" aria-label="Clipshaper reads the transcript, picks three moments and turns them into vertical clips with captions">
  <div class="src glass" aria-hidden="true">
    <div class="src-top"><b>podcast-episode-42.mp4</b><span>48:12</span><span class="chip"><i></i>Finding moments</span></div>
    <div class="lines"><div class="scan"></div>${LINES.map(([t, s]) => `<div class="line"><time>${t}</time><span>${esc(s)}</span></div>`).join('')}</div>
    <div class="tl"><div class="wave">${Array.from({ length: 64 }, (_, i) => `<i style="height:${Math.round(25 + 70 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)))}%"></i>`).join('')}</div>${SEGS.map(([l, w], k) => `<span class="seg" style="left:${l}%;width:${w + 6}%"><b>${PHONES[k].score}</b></span>`).join('')}</div>
  </div>
  <div class="phones" aria-hidden="true">${PHONES.map((p) => `
    <div class="ph" data-shift="${p.shift}" style="--hl:${p.hl}">
      <div class="scene"><div class="bgc" style="background:${p.bg}"></div>${person(p.p)}${person(p.p2, 'b')}</div>
      <div class="meta"><span>${esc(p.title)}</span><span class="sc">${p.score}/10</span></div>
      <div class="cap">${p.cap.split(' ').map((w) => `<span>${esc(w)}</span>`).join(' ')}</div>
    </div>`).join('')}
  </div>
</div>`;

// ---------- content ----------
const FAQ = [
  ['Is it really free?', 'Yes. No watermark, no limits on minutes or clips, no account. Clipshaper runs on your own computer, so it costs us nothing when you use it. If it helps you, you can tip us on Ko-fi.'],
  ['Is my video uploaded anywhere?', "No. The app does everything on your computer. The web version runs inside your browser tab: the video never leaves it. The only downloads are the AI models, once, from Hugging Face, and the browser keeps them for next time."],
  ['How does it pick the best moments?', "It writes down every word with timings, then a small AI model reads the transcript like an editor would. It looks for a line that grabs attention on its own, a moment that makes sense without the rest of the video, and a payoff. Each clip gets a score out of 10, and the best ones come first. You can trim any clip to the word."],
  ['What kind of videos work best?', 'Anything with talking: podcasts, interviews, streams, lectures, sermons, vlogs, reaction videos. It needs speech to find moments, so music videos and silent footage won\'t work.'],
  ['Can I paste a YouTube, TikTok or Twitch link?', "In the app, yes: YouTube, TikTok, Instagram, X, Twitch, Facebook, Vimeo and many more. In the browser, no, because browsers don't let one website download videos from another. Only use videos you own or have permission to use."],
  ['Web or app: which should I use?', "Try the web version first, nothing to install. The app is faster, uses bigger and smarter models, works in about 99 languages, pastes links, and exports in full quality in the background. The web version needs a recent Chrome or Edge for the smart picks."],
  ['How does the vertical framing work?', 'Clipshaper finds faces in each clip and moves a 9:16 window to follow the speaker. It holds still when it can and jumps on camera cuts, like a camera operator would. You can switch any clip to Centre or Whole frame (the full shot over a blurred background).'],
  ['What do I need?', "Web: Chrome or Edge on a computer from the last few years. App: a Mac with Apple silicon (macOS 12 or later) or Windows 10/11, 8 GB of memory, and about 3 GB of space for the models."],
];

const home = () => `
<section class="hero">
  <div class="wrap center">
    <div class="reveal">${studioBadge('en')}</div>
    ${headline('Long video in.<br><em>Short clips out.</em>')}
    <p class="lede reveal">Clipshaper finds the best moments in your podcast, stream or talk, frames them for phones and adds captions that pop. Free, no watermark, and your video is never uploaded.</p>
    ${dlButtons('cta reveal')}
    <p class="small reveal">Free forever · No sign-up · Mac, Windows and your browser</p>
  </div>
  ${demo()}
</section>
<section class="steps-sec">
  <div class="wrap">
    <div class="sec-head center reveal"><p class="eyebrow">How it works</p><h2>Three steps. No editing skills.</h2></div>
    <div class="trio">
      <div class="step glass reveal"><span class="n">1</span><span class="s-ic">${ICON.drop}</span><h3>Drop a video</h3><p>Any long video with talking. In the app you can also paste a link from YouTube, TikTok, Twitch and more.</p></div>
      <div class="step glass reveal"><span class="n">2</span><span class="s-ic">${ICON.spark}</span><h3>It finds the moments</h3><p>Every word is written down, then AI picks the stretches that hook, make sense alone and pay off.</p></div>
      <div class="step glass reveal"><span class="n">3</span><span class="s-ic">${ICON.cut}</span><h3>Tweak and export</h3><p>Trim to the word, pick a caption style, and export vertical 1080×1920 clips ready to post.</p></div>
    </div>
  </div>
</section>
<section class="bento-sec">
  <div class="wrap">
    <div class="sec-head reveal"><p class="eyebrow">Everything the paid tools do</p><h2>Built for Shorts, Reels and TikTok. <span class="muted">Without the subscription.</span></h2></div>
    <div class="feats">
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.spark}</span><h3>Finds the best moments</h3><p>AI reads the whole transcript like an editor and ranks every clip out of 10. The strongest come first.</p></article>
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.face}</span><h3>Follows the speaker</h3><p>Wide shots become tall ones. The frame tracks faces, holds still when it can and cuts with the video.</p></article>
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.cc}</span><h3>Captions that pop</h3><p>Word-by-word captions in 9 styles, burned right into the video.</p><div class="styles-row" aria-hidden="true"><span style="color:#c6ff3d">BOLD</span><span style="color:#ffd23f">HIGHLIGHT</span><span style="color:#3dffb0">NEON</span><span style="color:#ffe14d">COMIC</span></div></article>
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.link}</span><h3>Paste any link</h3><p>YouTube, TikTok, Instagram, X, Twitch, Facebook, Vimeo and many more, right in the app.</p></article>
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.lock}</span><h3>Nothing uploaded</h3><p>Your video stays on your computer. No cloud, no account, no one training on your content.</p></article>
      <article class="feat-c glass reveal"><span class="s-ic">${ICON.free}</span><h3>Free. Really.</h3><p>No watermark, no monthly minutes, no credits. Open source, so anyone can check how it works.</p></article>
    </div>
  </div>
</section>
<section class="private-band">
  <div class="wrap">
    <p class="big-statement">${words('AI clip tools charge up to $29 a month, stamp a watermark on the free plan and upload every video you give them. Clipshaper does the same job for free, on your own computer.')}</p>
  </div>
</section>
<section class="compare-sec">
  <div class="wrap narrow">
    <div class="sec-head center reveal"><h2>Clipshaper vs. typical clip apps</h2></div>
    <div class="compare glass reveal">
      <div class="c-row c-head"><span></span><b>Clipshaper</b><b>Typical AI clip app</b></div>
      ${[['Price', 'Free', '$15–29 a month'], ['Watermark', 'Never', 'On the free plan'], ['Your video', 'Stays on your computer', 'Uploaded to their servers'], ['Limits', 'None', 'Minutes or credits per month'], ['Account', 'Not needed', 'Required']].map(([k, a, b]) => `<div class="c-row"><span>${k}</span><b class="yes">${a}</b><span>${b}</span></div>`).join('\n      ')}
    </div>
  </div>
</section>
<section class="steps-sec">
  <div class="wrap">
    <div class="sec-head center reveal"><p class="eyebrow">Two ways to use it</p><h2>Try it now. Keep the app.</h2></div>
    <div class="two">
      <article class="way glass reveal"><span class="s-ic">${ICON.globe}</span><h3>In your browser</h3><ul>
        <li>${ICON.check}Nothing to install, starts in seconds</li><li>${ICON.check}Your video stays in the tab</li><li>${ICON.check}Best in Chrome or Edge</li><li class="no">${ICON.x}No links (browsers block that)</li></ul>
        <a class="btn btn-brand" href="${B}try/">${ICON.spark}Open Clipshaper Web</a></article>
      <article class="way glass reveal"><span class="s-ic">${ICON.laptop}</span><h3>The app</h3><ul>
        <li>${ICON.check}Paste links from YouTube, TikTok, Twitch…</li><li>${ICON.check}Bigger, smarter models, about 99 languages</li><li>${ICON.check}Faster, full-quality export</li><li>${ICON.check}Mac and Windows</li></ul>
        <a class="btn btn-glass" href="${B}download.html">${ICON.drop}Download free</a></article>
    </div>
  </div>
</section>
<section class="faq-sec">
  <div class="wrap narrow">
    <div class="sec-head center reveal"><h2>Questions</h2></div>
    ${FAQ.slice(0, 4).map(([q, a]) => `<details class="qa glass reveal"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    <p class="center reveal"><a class="more" href="${B}faq.html">All questions ${ICON.arrow}</a></p>
  </div>
</section>
${endCta()}`;

function endCta() {
  return `<section class="end">
  <div class="wrap center">
    <img class="end-icon reveal" src="${B}img/icon-256.png" width="112" height="112" alt="">
    <h2 class="reveal">Your next ten Shorts are already in that video.</h2>
    <p class="lede reveal">Drop it into Clipshaper and see what it finds. Free, private, no sign-up.</p>
    ${dlButtons('cta reveal')}
  </div>
</section>`;
}
const pageHero = (h1, lead) => `<section class="page-hero"><div class="wrap center">${headline(esc(h1))}${lead ? `<p class="lede reveal">${lead}</p>` : ''}</div></section>`;

const download = () => `${pageHero('Download Clipshaper', `Version ${V}. Free, no account, no watermark. Or <a href="${B}try/">try it in your browser</a> first.`)}
<section class="dl-sec"><div class="wrap">
  <div class="dl-grid">
    <article class="dl-card glass reveal" id="mac" data-os-card="mac">
      <span class="dl-ic">${ICON.apple}</span><h2>Mac</h2><p>macOS 12 or later, Apple silicon (M1 or newer).</p>
      <a class="btn btn-brand big" href="${DL}${FILES.mac}">Download for Mac</a>
      <details class="help"><summary>Mac says it can't check the app?</summary><p>Clipshaper isn't sold through the App Store, so the first time, right-click the app in Applications, choose Open, then Open again. After that it opens normally.</p></details>
    </article>
    <article class="dl-card glass reveal" id="win" data-os-card="win">
      <span class="dl-ic">${ICON.win}</span><h2>Windows</h2><p>Windows 10 or 11, 64-bit.</p>
      <a class="btn btn-brand big" href="${DL}${FILES.win}">Download for Windows</a>
      <details class="help"><summary>Windows shows a blue warning?</summary><p>That's SmartScreen, shown for new apps without a paid certificate. Click "More info", then "Run anyway".</p></details>
    </article>
  </div>
  <div class="sizes glass reveal">
    <h3>What gets downloaded</h3>
    <div class="size-row"><span>The app</span><b>${mb(FILES.mac)} MB (Mac) · ${mb(FILES.win)} MB (Windows)</b></div>
    <div class="size-row"><span>Speech model (first run)</span><b>574 MB</b></div>
    <div class="size-row"><span>Moment finder (first run)</span><b>1.9 GB</b></div>
    <p class="muted">The models download once from Hugging Face, from inside the app. Already use Captionshaper or Writeshaper? Clipshaper reuses their models, so there's nothing extra to download.</p>
  </div>
  <p class="center reveal">Clipshaper is open source. <a href="${SITE.github}">Read the code on GitHub</a>.</p>
</div></section>`;

const faq = () => `${pageHero('Questions', '')}
<section class="faq-sec"><div class="wrap narrow">${FAQ.map(([q, a]) => `<details class="qa glass reveal"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
${endCta()}`;

const PRIVACY = [
  ['The short version', 'Clipshaper never uploads your videos, transcripts or clips. There are no accounts, no analytics and no cookies.'],
  ['The app', 'Everything happens on your computer: listening, picking moments, finding faces and exporting. The app connects to the internet only to download its AI models once (from Hugging Face), to check once a day whether a new version exists (from GitHub; you can turn this off), and, when you paste a link, to download that video from the site it came from.'],
  ['Pasted links and browser logins', 'If a site asks you to be logged in (Instagram, for example), the app can borrow your browser\'s login, only when you click the button that offers it. Your login is read on your computer and sent only to that video\'s own site, never to us.'],
  ['The web version', 'Clipshaper Web runs inside your browser tab. Your video is opened from your disk and never sent anywhere. The page loads its AI models and two code libraries from Hugging Face and jsDelivr; the browser keeps them so the next visit is instant. Your recent work is saved in your own browser only.'],
  ['This website', 'hollowbit.dev is hosted on GitHub Pages. We add no analytics or tracking. GitHub may keep standard server logs, as every web host does.'],
];
const privacy = () => `${pageHero('Privacy', 'Your videos stay yours.')}
<section class="prose"><div class="wrap narrow glass reveal">
  ${PRIVACY.map(([h, t]) => `<h2>${esc(h)}</h2>\n  <p>${esc(t)}</p>`).join('\n  ')}
  <p class="muted">Updated ${UPDATED}. Questions? <a href="${SITE.studio}contact/">Get in touch</a>.</p>
</div></section>`;

const notfound = () => `<section class="page-hero"><div class="wrap center"><h1>Not found</h1><p class="lede">That page isn't here.</p><div class="cta"><a class="btn btn-brand big" href="${B}">Go home</a></div></div></section>`;

const PAGES = {
  index: ['Clipshaper · Free AI clip maker, no watermark, nothing uploaded', 'Turn long videos into short vertical clips with captions. Clipshaper finds the best moments, follows faces and adds captions. Free, no watermark, no sign-up, and your video is never uploaded.', home,
    { ld: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }],
  download: ['Download Clipshaper for Mac and Windows · Free', 'Download Clipshaper, the free AI clip maker for Mac and Windows. No watermark, no account, nothing uploaded.', download],
  faq: ['Clipshaper FAQ', 'Answers about Clipshaper: price, privacy, how it picks moments, links, web vs app, and what you need.', faq],
  privacy: ['Clipshaper privacy', 'Clipshaper never uploads your videos. No accounts, no analytics, no cookies.', privacy],
};

// ---------- write ----------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const assets = path.join(here, 'assets');
const css = fs.readFileSync(path.join(assets, 'base.css'), 'utf8') + studioCss + fs.readFileSync(path.join(assets, 'clip.css'), 'utf8');
fs.writeFileSync(path.join(out, 'site.css'), css);
fs.copyFileSync(path.join(assets, 'site.js'), path.join(out, 'site.js'));
fs.cpSync(path.join(assets, 'fonts'), path.join(out, 'fonts'), { recursive: true });
fs.cpSync(path.join(assets, 'img'), path.join(out, 'img'), { recursive: true });
const h = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
const cssv = h(css); const jsv = h(fs.readFileSync(path.join(assets, 'site.js'), 'utf8'));
for (const [page, [title, desc, fn, opt]] of Object.entries(PAGES)) fs.writeFileSync(path.join(out, `${page}.html`), layout(page, title, desc, fn(), { ...(opt || {}), cssv, jsv }));
fs.writeFileSync(path.join(out, '404.html'), layout('404', 'Not found · Clipshaper', 'Page not found.', notfound(), { cssv, jsv }));

// The web version: the app's own window code, with web/backend.js standing in for the computer.
const tryDir = path.join(out, 'try');
fs.mkdirSync(path.join(tryDir, 'core'), { recursive: true });
for (const f of ['captions.js', 'fonts.js', 'render.js', 'reframe.js', 'moments.js']) fs.copyFileSync(path.join(root, 'src/core', f), path.join(tryDir, 'core', f));
for (const f of ['app.js', 'app.css', 'faces.js']) fs.copyFileSync(path.join(root, 'src/renderer', f), path.join(tryDir, f));
for (const f of ['backend.js', 'speech-worker.js']) fs.copyFileSync(path.join(root, 'web', f), path.join(tryDir, f));
fs.mkdirSync(path.join(tryDir, 'assets', 'fonts'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'assets/fonts'))) if (f.endsWith('.ttf')) fs.copyFileSync(path.join(root, 'assets/fonts', f), path.join(tryDir, 'assets/fonts', f));
fs.copyFileSync(path.join(assets, 'img/icon-64.png'), path.join(tryDir, 'assets/icon-64.png'));
fs.copyFileSync(path.join(assets, 'img/icon-256.png'), path.join(tryDir, 'assets/icon.png'));
const faces = path.join(tryDir, 'faces'); fs.mkdirSync(faces);
const mp = path.join(root, 'node_modules/@mediapipe/tasks-vision');
fs.copyFileSync(path.join(mp, 'vision_bundle.mjs'), path.join(faces, 'vision_bundle.mjs'));
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) fs.copyFileSync(path.join(mp, 'wasm', f), path.join(faces, f));
fs.copyFileSync(path.join(root, 'vendor/models/blaze_face_short_range.tflite'), path.join(faces, 'model.tflite'));
const webv = h([...fs.readdirSync(tryDir).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => fs.readFileSync(path.join(tryDir, f), 'utf8'))].join(''));
fs.writeFileSync(path.join(tryDir, 'index.html'), fs.readFileSync(path.join(root, 'web/index.html'), 'utf8').replace(/__V__/g, webv));
// app.js imports faces.js by a relative path: give that import the same version.
fs.writeFileSync(path.join(tryDir, 'app.js'), fs.readFileSync(path.join(tryDir, 'app.js'), 'utf8').replace("from './faces.js'", `from './faces.js?v=${webv}'`));

const urls = ['', 'try/', 'download.html', 'faq.html', 'privacy.html'];
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE.url}/${u}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
fs.writeFileSync(path.join(out, 'llms.txt'), `# Clipshaper\n\n> Free, open-source AI clip maker by Hollowbit Studio: turns long videos (podcasts, streams, talks) into short vertical clips with captions for TikTok, Reels and YouTube Shorts. It transcribes with Whisper, picks the best moments with a small local language model (Qwen), follows faces to reframe 16:9 to 9:16, and burns in word-by-word captions. Runs on Mac and Windows, or in the browser at ${SITE.url}/try/. Videos are never uploaded; no watermark, no account.\n\n- [Try in the browser](${SITE.url}/try/)\n- [Download](${SITE.url}/download.html)\n- [FAQ](${SITE.url}/faq.html)\n- [Privacy](${SITE.url}/privacy.html)\n- [Source code](${SITE.github})\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${Object.keys(PAGES).length} pages + try/ into docs/`);
