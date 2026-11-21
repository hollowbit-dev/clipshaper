// Clipshaper window: drop a video → it listens, picks the best moments, frames them for a phone
// → you check each clip (trim, captions, framing) → export. Everything runs on this computer.
import { scan } from './faces.js?v=27c2c727';

const C = window.Captions; const R = window.CaptionRender; const Fonts = window.CaptionFonts; const RF = window.Reframe;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const ASSETS = window.cs.assetsBase || '../../assets';
const OUT_W = 1080; const OUT_H = 1920;

const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9" stroke-width="2.2"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  face: '<svg viewBox="0 0 16 16"><circle cx="8" cy="7" r="3"/><path d="M3 14c.8-2.4 2.8-3.6 5-3.6s4.2 1.2 5 3.6"/><path d="M1.5 4.5v-2a1 1 0 0 1 1-1h2M11.5 1.5h2a1 1 0 0 1 1 1v2"/></svg>',
  fit: '<svg viewBox="0 0 16 16"><rect x="4" y="1.5" width="8" height="13" rx="1.5"/><rect x="2" y="5.5" width="12" height="5" rx="1"/></svg>',
  center: '<svg viewBox="0 0 16 16"><rect x="4" y="1.5" width="8" height="13" rx="1.5"/><path d="M8 6v4M6 8h4"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z"/></svg>',
  link: '<svg viewBox="0 0 16 16"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l.9-.9"/></svg>',
  check: '<svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  spark: '<svg viewBox="0 0 16 16"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8l5.1-1.4z"/></svg>',
  cc: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="2"/><path d="M7 6.5a2 2 0 1 0 0 3M11.5 6.5a2 2 0 1 0 0 3"/></svg>',
};

let state = { settings: {}, models: [], recent: [], version: '' };
let current = null; // { media, project, sel }
let job = null;

// ---------- Helpers ----------
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60); const s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const fmtLen = (t) => `${Math.round(t)}s`;
const gb = (b) => (b / 1e9).toFixed(1) + ' GB';
function toast(msg, { kind = '', action, onAction, ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn ghost sm">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { onAction(); el.remove(); };
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Fonts (the preview measures text the same way the export does) ----------
const fontsReady = Promise.all(Fonts.FONTS.map((f) => new FontFace(Fonts.css(f.id), `url(${ASSETS}/fonts/${f.file})`).load().then((ff) => document.fonts.add(ff)).catch(() => {})));
const measureCtx = document.createElement('canvas').getContext('2d');
const measureCache = new Map();
function measure(text, font, em) {
  const k = `${font}|${text}`;
  let w = measureCache.get(k);
  if (w == null) { measureCtx.font = `100px "${Fonts.css(font)}"`; w = measureCtx.measureText(text).width; measureCache.set(k, w); }
  return w * em / 100;
}
fontsReady.then(() => { measureCache.clear(); });

// ---------- Start ----------
async function boot() {
  Object.assign(state, await window.cs.getState());
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.add(`os-${state.platform}`);
  window.cs.onModelProgress(onModelProgress);
  window.cs.onProgress(onJobProgress);
  window.cs.onOpenFiles((files) => files[0] && openVideo(files[0]));
  window.cs.onFullscreen((fs) => document.documentElement.classList.toggle('fullscreen', fs));
  setupDrop();
  const pending = await window.cs.rendererReady();
  if (pending[0]) openVideo(pending[0]); else renderHome();
}

// ---------- Home ----------
const modelsReady = () => state.models.every((m) => m.installed);
function renderHome() {
  current = null; stopPreview();
  const need = state.models.filter((m) => !m.installed);
  const needBytes = need.reduce((t, m) => t + m.size - (m.partial || 0), 0);
  const downloading = state.models.some((m) => m.downloading);
  view.innerHTML = `
  <div class="home">
    <div class="home-main">
      ${window.cs.web ? '<a class="brand" href="../" title="Clipshaper website">' : '<div class="brand">'}<img class="logo" src="${ASSETS}/icon.png" alt=""><span>Clipshaper</span>${window.cs.web ? '<span class="web-pill">Web</span></a>' : '</div>'}
      <h1>Long video in.<br><span class="grad">Short clips out.</span></h1>
      <p class="lede">Drop a podcast, stream or talk. Clipshaper finds the best moments, frames them for phones and adds captions. On your computer, nothing uploaded.</p>
      ${need.length ? `
      <div class="setup card">
        <div class="setup-head">
          <div><b>One-time setup</b><span class="muted">Clipshaper needs two models to listen and pick moments. ${gb(needBytes)}, downloaded once.</span></div>
          ${downloading ? '<button class="btn ghost" id="dl-cancel">Pause</button>' : `<button class="btn primary" id="dl-go">${ICON.down}Download ${gb(needBytes)}</button>`}
        </div>
        ${state.models.map((m) => `<div class="dl-row" data-id="${m.id}"><span>${m.id === 'speech' ? 'Speech model' : 'Moment finder'}</span><div class="bar"><i style="width:${m.installed ? 100 : Math.round(100 * (m.partial || 0) / m.size)}%"></i></div><span class="muted num dl-pct">${m.installed ? 'Ready' : gb(m.size)}</span></div>`).join('')}
      </div>` : ''}
      <button class="drop ${need.length ? 'disabled' : ''}" id="drop">
        <div class="drop-icon">${ICON.spark}</div>
        <div class="drop-text"><b>Drop a video here</b><span>or click to choose · MP4, MOV, MKV, WebM</span></div>
      </button>
      ${window.cs.web ? `<div class="web-note card" id="web-note">
        <span class="link-icon">${ICON.link}</span>
        <div><b>Got a YouTube, TikTok or Twitch link?</b><span class="muted">Browsers can't download from other sites. The free app can, and it's faster with bigger models.</span></div>
        <a class="btn" href="../download.html">Get the app</a>
      </div>
      <p class="fine muted" id="gpu-note">Runs in this tab. Your video is never uploaded. The first run downloads about 1 GB of models, once.</p>` : `<form class="link ${need.length ? 'disabled' : ''}" id="link-form">
        <span class="link-icon">${ICON.link}</span>
        <input id="link" placeholder="Or paste a link: YouTube, TikTok, Instagram, X, Twitch…" spellcheck="false" autocomplete="off">
        <button class="btn primary" id="link-go" type="submit">Get clips</button>
      </form>
      <p class="fine muted">Only use videos you own or have permission to use.</p>`}
    </div>
    ${state.recent.length ? `<aside class="recent"><h3>Recent</h3>${state.recent.slice(0, 8).map((r) => `<button class="recent-row" data-file="${esc(r.file)}"><span class="rname">${esc(r.name)}</span><span class="muted num">${fmt(r.duration)}</span></button>`).join('')}</aside>` : ''}
  </div>`;
  $('#drop').onclick = async () => { if (!modelsReady()) return toast('Download the models first.'); const f = await window.cs.pickVideo(); if (f) openVideo(f); };
  $$('.recent-row').forEach((b) => { b.onclick = () => openVideo(b.dataset.file); });
  if ($('#link-form')) $('#link-form').onsubmit = (e) => { e.preventDefault(); openLink($('#link').value); };
  if (window.cs.web) window.cs.hasGpu().then((ok) => { if (!ok && $('#gpu-note')) $('#gpu-note').textContent = "This browser has no WebGPU, so clips are picked by a simpler method. Chrome or Edge on a recent computer gives the best picks, or get the app."; });
  const go = $('#dl-go'); if (go) go.onclick = () => { state.models.filter((m) => !m.installed).forEach((m) => window.cs.downloadModel(m.id)); state.models.forEach((m) => { if (!m.installed) m.downloading = true; }); renderHome(); };
  const cancel = $('#dl-cancel'); if (cancel) cancel.onclick = () => state.models.forEach((m) => window.cs.cancelDownload(m.id));
}
async function onModelProgress(p) {
  const m = state.models.find((x) => x.id === p.id); if (!m) return;
  if (p.done || p.error) {
    state.models = await window.cs.models();
    if (p.error && p.error !== 'cancelled') toast(p.error, { kind: 'bad' });
    if (!current) renderHome();
    return;
  }
  m.partial = p.got;
  const row = $(`.dl-row[data-id="${p.id}"]`);
  if (row) { $('i', row).style.width = `${Math.round(100 * p.got / p.total)}%`; $('.dl-pct', row).textContent = p.verifying ? 'Checking…' : `${Math.round(100 * p.got / p.total)}%`; }
}

function setupDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); if (++depth === 1 && !job) document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const f = e.dataTransfer.files[0]; if (!f || job) return;
    if (!modelsReady()) return toast('Download the models first.');
    openVideo(window.cs.pathFor(f));
  });
}

// ---------- Open + analyse ----------
async function openVideo(file) {
  if (job) return;
  let media;
  try { media = await window.cs.openMedia(file); } catch (e) { return toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'bad' }); }
  const r = await window.cs.getState(); state.recent = r.recent;
  if (media.project && media.project.clips) {
    current = { media, project: media.project, sel: media.project.clips[0] ? media.project.clips[0].id : null };
    renderClips();
    scanFaces();
    return;
  }
  if (!modelsReady()) { renderHome(); return toast('Download the models first.'); }
  current = { media, project: null, sel: null };
  analyze();
}

// A link: download it (stage "fetch"), then carry on exactly like a dropped file.
async function openLink(raw, { browser } = {}) {
  const url = String(raw || '').trim();
  if (job || !url) return;
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) return toast("That doesn't look like a link.", { kind: 'bad' });
  if (!modelsReady()) return toast('Download the models first.');
  job = { id: uid(), fetch: true };
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* keep */ }
  current = { media: { name: host, info: { duration: 0 } }, project: null, sel: null };
  renderWorking(); setStage('fetch', 0);
  try {
    const r = await window.cs.downloadLink({ jobId: job.id, url, browser });
    const media = await window.cs.openMedia(r.file, r.title);
    const st = await window.cs.getState(); state.recent = st.recent;
    if (media.project && media.project.clips) {
      job = null;
      current = { media, project: media.project, sel: media.project.clips[0] ? media.project.clips[0].id : null };
      renderClips(); scanFaces(); return;
    }
    current = { media, project: null, sel: null };
    $('.work-head b').textContent = media.name; $('.work-head .muted').textContent = fmt(media.info.duration);
    analyze();
  } catch (e) {
    const wasCancel = /Cancelled/.test(String(e.message)) || (job && job.cancelled);
    job = null;
    renderHome();
    if (wasCancel) return;
    const i = $('#link'); if (i) i.value = url;
    const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (/^LOGIN: /.test(msg) && !browser) {
      // Offer the user's own browser login (read on this computer, only sent to that site).
      const list = await window.cs.browsers();
      const b = list.find((x) => x.id === state.settings.browser) || list[0];
      if (b) {
        toast(`${msg.slice(7)} Use your ${b.name} login? You need to be logged in there.`, { kind: 'bad', ms: 20000, action: `Use ${b.name} login`, onAction: () => { window.cs.setSettings({ browser: b.id }); openLink(url, { browser: b.id }); } });
        return;
      }
    }
    toast(msg.replace(/^LOGIN: /, '') + (/^LOGIN: /.test(msg) ? ' Download it yourself, then drop the file in.' : ''), { kind: 'bad', ms: 9000 });
  }
}
// Pasting a link anywhere on the home screen starts it.
window.addEventListener('paste', (e) => {
  if (current || job || document.activeElement === $('#link')) return;
  const t = (e.clipboardData.getData('text') || '').trim();
  if (/^https?:\/\//i.test(t)) { e.preventDefault(); openLink(t); }
});

const FETCH = { id: 'fetch', label: 'Downloading the video', sub: 'From the link you pasted' };
const STAGES = [
  { id: 'listen', label: 'Listening', sub: 'Writing down every word' },
  { id: 'moments', label: 'Finding the best moments', sub: 'Reading the whole thing like an editor' },
  { id: 'faces', label: 'Framing for phones', sub: 'Following faces in each clip' },
];
function renderWorking() {
  const { media } = current;
  view.innerHTML = `
  <div class="working">
    <div class="work-card card">
      <div class="work-head"><b class="ell">${esc(media.name)}</b><span class="muted num">${fmt(media.info.duration)}</span></div>
      <ol class="stages">${stageList().map((s) => `<li data-stage="${s.id}"><span class="dot"></span><div><b>${s.label}</b><span class="muted st-sub">${s.sub}</span></div><span class="muted num st-pct"></span></li>`).join('')}</ol>
      <div class="bar big"><i id="work-bar"></i></div>
      <div class="work-foot"><span class="muted" id="work-note">This runs on your computer. A 30-minute video takes a few minutes.</span><button class="btn ghost" id="work-cancel">Cancel</button></div>
    </div>
  </div>`;
  $('#work-cancel').onclick = () => { if (job) window.cs.cancelJob(job.id); job = job && { ...job, cancelled: true }; };
}
const stageList = () => (job && job.fetch ? [FETCH, ...STAGES] : STAGES);
function setStage(id, pct, sub) {
  const order = stageList().map((s) => s.id);
  const k = order.indexOf(id);
  $$('.stages li').forEach((li, i) => { li.classList.toggle('done', i < k); li.classList.toggle('on', i === k); });
  const li = $(`.stages li[data-stage="${id}"]`); if (!li) return;
  if (pct != null) $('.st-pct', li).textContent = `${Math.round(pct)}%`;
  if (sub) $('.st-sub', li).textContent = sub;
  const w = job && job.fetch ? [0.15, 0.53, 0.19, 0.13] : [0.62, 0.23, 0.15]; let total = 0;
  for (let i = 0; i < k; i++) total += w[i];
  total += w[k] * (pct || 0) / 100;
  const bar = $('#work-bar'); if (bar) bar.style.width = `${Math.round(total * 100)}%`;
}
function onJobProgress(p) {
  if (!job || p.jobId !== job.id) {
    if (exporting && p.jobId === exporting.jobId) exporting.onPct(p.pct);
    return;
  }
  if (p.stage === 'fetch-setup') setStage('fetch', p.pct, 'Getting the link downloader (one time)');
  if (p.stage === 'fetch') {
    setStage('fetch', p.pct, p.title ? 'From the link you pasted' : null);
    if (p.title) { const h = $('.work-head b'); if (h) h.textContent = p.title; }
  }
  if (p.stage === 'listen') setStage('listen', p.pct, p.words ? `${(job.words = (job.words || 0) + p.words).toLocaleString()} words so far` : p.note || null);
  if (p.stage === 'moments') setStage('moments', p.pct, p.note || null);
  if (p.stage === 'cuts') setStage('moments', 100);
}

async function analyze() {
  if (!job) { job = { id: uid() }; renderWorking(); }
  setStage('listen', 0);
  const { media } = current;
  try {
    const r = await window.cs.analyze({ jobId: job.id, file: media.file, language: state.settings.language || 'auto', info: media.info });
    const clips = r.clips.map((c, i) => ({ id: uid(), rank: i + 1, start: c.start, end: c.end, title: c.title, score: c.score, mode: 'follow', keys: null, samples: null }));
    current.project = { v: 1, words: r.words, noSpace: r.noSpace, language: r.language, duration: r.duration, cuts: r.cuts, method: r.method, clips, style: R.fromPreset(state.settings.style || 'highlight'), captions: state.settings.captions !== false };
    current.sel = clips[0] ? clips[0].id : null;
    save();
    if (!clips.length) { job = null; toast('No speech found in this video, so there were no moments to pick.', { kind: 'bad' }); return renderHome(); }
    setStage('faces', 0);
    await scanFaces({ onEach: (k, n) => setStage('faces', 100 * k / n, `Clip ${Math.min(n, k + 1)} of ${n}`) });
    job = null;
    renderClips();
  } catch (e) {
    const wasCancel = /Cancelled/.test(String(e.message)) || (job && job.cancelled);
    job = null;
    if (!wasCancel) toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'bad', ms: 8000 });
    renderHome();
  }
}

// Face paths for clips that don't have one yet (or whose trim went past what was scanned).
let scanning = false;
async function scanFaces({ onEach } = {}) {
  if (scanning || !current) return; scanning = true;
  const proj = current.project; const media = current.media;
  try {
    const todo = proj.clips.filter((c) => needsScan(c));
    for (let k = 0; k < todo.length; k++) {
      if (!current || current.project !== proj) return;
      const c = todo[k];
      if (onEach) onEach(k, todo.length);
      const a = Math.max(0, c.start - 2); const b = Math.min(media.info.duration, c.end + 2);
      const frames = await window.cs.frames({ file: media.file, start: a, end: b, fps: 3 });
      const samples = await scan(frames);
      c.samples = { a, b, list: samples.map((s) => ({ t: s.t + a, faces: s.faces })) };
      computeKeys(c);
      save();
      if (!job) { updateCard(c); if (c.id === current.sel) drawPreview(true); }
    }
    if (onEach) onEach(todo.length, todo.length);
  } catch (e) { console.error(e); } finally { scanning = false; }
}
const needsScan = (c) => !c.samples || c.start < c.samples.a - 0.01 || c.end > c.samples.b + 0.01;
function computeKeys(c) {
  if (!c.samples) { c.keys = null; return; }
  const { info } = current.media;
  const list = c.samples.list.filter((s) => s.t >= c.start - 0.4 && s.t <= c.end + 0.4).map((s) => ({ t: Math.max(0, s.t - c.start), faces: s.faces }));
  const cuts = (current.project.cuts || []).filter((t) => t > c.start && t < c.end).map((t) => t - c.start);
  c.keys = RF.path(list, cuts, { srcW: info.width, srcH: info.height, duration: c.end - c.start });
  c.faceShare = list.length ? list.filter((s) => s.faces.length).length / list.length : 0;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  const { media, project } = current || {}; if (!project) return;
  saveTimer = setTimeout(() => window.cs.saveProject({ id: media.id, project }), 300);
}

// ---------- Clips screen ----------
const selClip = () => current && current.project.clips.find((c) => c.id === current.sel);
const isWide = () => { const { info } = current.media; return RF.cropShare(info.width, info.height) < 0.999; };

function renderClips() {
  stopPreview();
  const { media, project } = current;
  const clips = project.clips;
  view.innerHTML = `
  <div class="app">
    <header class="top">
      <button class="btn ghost icon" id="home" title="New video">${ICON.back}</button>
      <div class="top-title"><b class="ell">${esc(media.name)}</b><span class="muted">${clips.length} clip${clips.length === 1 ? '' : 's'} found${project.method === 'fallback' ? ' · quick pick' : ''}</span></div>
      <div class="grow"></div>
      <button class="btn primary" id="export-all" ${clips.length ? '' : 'disabled'}>${ICON.down}Export ${clips.length > 1 ? `all ${clips.length}` : 'clip'}</button>
    </header>
    <div class="body">
      <nav class="list" id="list">${clips.map(cardHtml).join('')}</nav>
      <main class="stage" id="stage"></main>
      <aside class="side" id="side"></aside>
    </div>
  </div>`;
  $('#home').onclick = () => { if (!exporting) renderHome(); };
  $('#export-all').onclick = () => exportClips(current.project.clips);
  $('#list').onclick = (e) => { const b = e.target.closest('.clip-card'); if (b) select(b.dataset.id); };
  renderStage(); renderSide();
  thumbs();
}
function scoreClass(s) { return s >= 8 ? 'hot' : s >= 6 ? 'good' : ''; }
function cardHtml(c, i) {
  return `<button class="clip-card ${c.id === current.sel ? 'sel' : ''}" data-id="${c.id}">
    <div class="thumb"><canvas width="90" height="160"></canvas><span class="len num">${fmtLen(c.end - c.start)}</span></div>
    <div class="cmeta"><span class="rank num">#${i + 1}</span><b class="ctitle">${esc(c.title)}</b><span class="muted num">${fmt(c.start)} – ${fmt(c.end)}</span>
    <span class="score ${scoreClass(c.score)}" title="How likely it is to work as a short">${c.score}/10</span></div>
  </button>`;
}
function updateCard(c) {
  const el = $(`.clip-card[data-id="${c.id}"]`); if (!el) return;
  const i = current.project.clips.indexOf(c);
  const tmp = document.createElement('div'); tmp.innerHTML = cardHtml(c, i);
  const fresh = tmp.firstElementChild;
  $('.cmeta', el).replaceWith($('.cmeta', fresh));
  $('.len', el).textContent = fmtLen(c.end - c.start);
  thumbFor(c);
}
function select(id) {
  if (current.sel === id) return;
  current.sel = id;
  $$('.clip-card').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
  renderStage(); renderSide();
}

// Thumbnails: one hidden video seeks to each clip and draws its framed first second.
const thumbVideo = document.createElement('video'); thumbVideo.muted = true; thumbVideo.preload = 'auto';
let thumbQueue = []; let thumbBusy = false;
function thumbs() { thumbQueue = current.project.clips.slice(); pumpThumbs(); }
function thumbFor(c) { if (!thumbQueue.includes(c)) thumbQueue.push(c); pumpThumbs(); }
async function pumpThumbs() {
  if (thumbBusy || !current) return; thumbBusy = true;
  try {
    const url = window.cs.fileUrl(current.media.file);
    if (thumbVideo.dataset.src !== url) { thumbVideo.src = url; thumbVideo.dataset.src = url; }
    while (thumbQueue.length && current) {
      const c = thumbQueue.shift();
      const t = Math.min(c.end - 0.1, c.start + 1);
      await new Promise((res) => { const done = () => { thumbVideo.removeEventListener('seeked', done); res(); }; thumbVideo.addEventListener('seeked', done); thumbVideo.currentTime = t; setTimeout(done, 2500); });
      const cv = $(`.clip-card[data-id="${c.id}"] canvas`); if (!cv) continue;
      drawFramed(cv.getContext('2d'), thumbVideo, c, t - c.start, cv.width, cv.height);
    }
  } finally { thumbBusy = false; }
}

// Draws the source video into a 9:16 box the way the export will frame it.
function drawFramed(g, video, c, tc, W, H) {
  const { info } = current.media;
  const vw = video.videoWidth || info.width; const vh = video.videoHeight || info.height;
  if (!vw || !vh) return;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const share = RF.cropShare(vw, vh);
  if (share >= 0.999) { // tall source: cover
    const s = Math.max(W / vw, H / vh); const dw = vw * s; const dh = vh * s;
    g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh); return;
  }
  if (c.mode === 'fit') {
    // Blurred backdrop the cheap way: draw tiny, let the scaler smear it.
    const tiny = drawFramed.tiny || (drawFramed.tiny = Object.assign(document.createElement('canvas'), { width: 18, height: 32 }));
    const tg = tiny.getContext('2d'); const s0 = Math.max(18 / vw, 32 / vh);
    tg.drawImage(video, (18 - vw * s0) / 2, (32 - vh * s0) / 2, vw * s0, vh * s0);
    g.imageSmoothingQuality = 'high'; g.globalAlpha = 0.85; g.drawImage(tiny, 0, 0, W, H); g.globalAlpha = 1;
    const dh = W * vh / vw; g.drawImage(video, 0, (H - dh) / 2, W, dh); return;
  }
  const cx = c.mode === 'center' || !c.keys ? 0.5 : RF.at(c.keys, tc);
  const sw = vh * 9 / 16; const sx = Math.max(0, Math.min(vw - sw, cx * vw - sw / 2));
  g.drawImage(video, sx, 0, sw, vh, 0, 0, W, H);
}

// ---------- Preview ----------
let pv = null; // { video, raf, clipId }
function stopPreview() { if (pv) { cancelAnimationFrame(pv.raf); pv.video.pause(); pv.video.removeAttribute('src'); pv.video.load(); pv = null; } }
function clipCaptions(c) {
  const p = current.project;
  const s = p.style;
  const words = p.words.filter((w) => w.end > c.start + 0.05 && w.start < c.end - 0.05).map((w) => ({ ...w, start: Math.max(0, w.start - c.start), end: Math.min(c.end - c.start, w.end - c.start) }));
  if (c.edits) for (const [k, v] of Object.entries(c.edits)) { const w = words.find((x) => Math.abs(x.start - (+k - c.start)) < 0.02); if (w) w.text = v; }
  return C.buildCaptions(words, { noSpace: p.noSpace, maxChars: R.fitChars(s, OUT_W, OUT_H), maxLines: s.maxLines, maxWords: s.maxWords });
}
function renderStage() {
  const c = selClip(); const st = $('#stage');
  if (!c) { st.innerHTML = '<div class="empty muted">No clips.</div>'; return; }
  st.innerHTML = `
    <div class="phone-wrap"><div class="phone"><canvas id="pv"></canvas><button class="play-big" id="play">${ICON.play}</button></div></div>
    <div class="transport">
      <button class="btn ghost icon" id="pp">${ICON.play}</button>
      <span class="num muted" id="tc">0:00 / ${fmt(c.end - c.start)}</span>
    </div>
    <div class="trim" id="trim"></div>`;
  const video = document.createElement('video');
  video.src = window.cs.fileUrl(current.media.file); video.preload = 'auto';
  pv = { video, raf: 0, clipId: c.id, caps: clipCaptions(c) };
  video.addEventListener('loadedmetadata', () => { video.currentTime = c.start; });
  video.addEventListener('seeked', () => drawPreview(true));
  const toggle = () => { const cc = selClip(); if (video.paused) { if (video.currentTime >= cc.end - 0.05 || video.currentTime < cc.start) video.currentTime = cc.start; video.play(); } else video.pause(); };
  video.addEventListener('play', () => { $('#pp').innerHTML = ICON.pause; $('#play').classList.add('hide'); loop(); });
  video.addEventListener('pause', () => { $('#pp') && ($('#pp').innerHTML = ICON.play); $('#play') && $('#play').classList.remove('hide'); });
  $('#pp').onclick = toggle; $('#play').onclick = toggle; $('#pv').onclick = toggle;
  sizeCanvas();
  renderTrim();
}
function sizeCanvas() {
  const cv = $('#pv'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  drawPreview(true);
}
window.addEventListener('resize', () => sizeCanvas());
function loop() {
  if (!pv) return;
  const c = selClip();
  if (c && pv.video.currentTime >= c.end) { pv.video.pause(); pv.video.currentTime = c.start; }
  drawPreview();
  if (!pv.video.paused) pv.raf = requestAnimationFrame(loop);
}
function drawPreview(force) {
  if (!pv) return;
  const c = selClip(); const cv = $('#pv'); if (!c || !cv || !cv.width) return;
  const g = cv.getContext('2d');
  const tc = Math.max(0, pv.video.currentTime - c.start);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (pv.video.readyState >= 2) drawFramed(g, pv.video, c, tc, cv.width, cv.height);
  else if (force) { g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); }
  if (current.project.captions) {
    const cap = pv.caps.find((k) => tc >= k.start && tc < k.end);
    if (cap) { g.setTransform(cv.width / OUT_W, 0, 0, cv.height / OUT_H, 0, 0); R.drawFrame(g, cap, current.project.style, tc, { W: OUT_W, H: OUT_H, measure, noSpace: current.project.noSpace }); }
  }
  const tcEl = $('#tc'); if (tcEl) tcEl.textContent = `${fmt(tc)} / ${fmt(c.end - c.start)}`;
  const ph = $('#trim .playhead'); if (ph && pv.trimView) ph.style.left = `${100 * (pv.video.currentTime - pv.trimView.a) / (pv.trimView.b - pv.trimView.a)}%`;
}

// Trim strip: the clip plus some context either side. Handles snap to word edges.
function renderTrim() {
  const c = selClip(); const el = $('#trim'); if (!c || !el) return;
  const d = current.media.info.duration;
  const pad = Math.max(10, (c.end - c.start) * 0.5);
  const a = Math.max(0, c.start - pad); const b = Math.min(d, c.end + pad);
  pv.trimView = { a, b };
  const X = (t) => `${(100 * (t - a) / (b - a)).toFixed(3)}%`;
  const words = current.project.words.filter((w) => w.end > a && w.start < b);
  el.innerHTML = `<div class="trim-track">${words.map((w) => `<i style="left:${X(w.start)};width:${X(a + Math.max(0.05, w.end - w.start))}"></i>`).join('')}
    <div class="trim-sel" style="left:${X(c.start)};right:calc(100% - ${X(c.end)})"><span class="h l"></span><span class="h r"></span></div><div class="playhead"></div></div>
    <div class="trim-words muted" id="trim-words"></div>`;
  const track = $('.trim-track', el);
  const tAt = (x) => { const r = track.getBoundingClientRect(); return a + (b - a) * Math.max(0, Math.min(1, (x - r.left) / r.width)); };
  const snap = (t, edge) => {
    let best = t; let bd = 0.6;
    for (const w of current.project.words) { const e = edge === 'l' ? w.start - 0.12 : w.end + 0.3; if (Math.abs(e - t) < bd) { bd = Math.abs(e - t); best = e; } }
    return best;
  };
  track.onpointerdown = (e) => {
    const h = e.target.closest('.h');
    if (!h) { pv.video.currentTime = Math.max(c.start, Math.min(c.end - 0.05, tAt(e.clientX))); return; }
    const side = h.classList.contains('l') ? 'l' : 'r';
    track.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const t = snap(tAt(ev.clientX), side);
      if (side === 'l') c.start = Math.max(0, Math.min(c.end - 5, t)); else c.end = Math.min(d, Math.max(c.start + 5, t));
      const sel = $('.trim-sel', el); sel.style.left = X(c.start); sel.style.right = `calc(100% - ${X(c.end)})`;
      pv.video.currentTime = side === 'l' ? c.start : Math.max(c.start, c.end - 1.5);
      showTrimWords(c);
    };
    const up = () => {
      track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up);
      computeKeys(c); pv.caps = clipCaptions(c); save(); updateCard(c); renderTrim(); renderSide();
      if (needsScan(c)) scanFaces();
    };
    track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
  };
  showTrimWords(c);
}
function showTrimWords(c) {
  const el = $('#trim-words'); if (!el) return;
  const ws = current.project.words.filter((w) => w.end > c.start && w.start < c.end);
  const first = ws.slice(0, 8).map((w) => w.text).join(' '); const last = ws.slice(-8).map((w) => w.text).join(' ');
  el.innerHTML = `<span>Starts: <b>“${esc(first)}…”</b></span><span>Ends: <b>“…${esc(last)}”</b></span>`;
}

// ---------- Side panel ----------
function renderSide() {
  const c = selClip(); const side = $('#side'); if (!side) return;
  if (!c) { side.innerHTML = ''; return; }
  const p = current.project;
  side.innerHTML = `
    <label class="field"><span>Title</span><input id="title" value="${esc(c.title)}" spellcheck="true"><small class="muted">Used as the file name.</small></label>
    ${isWide() ? `<div class="field"><span>Framing</span><div class="seg" id="mode">
      <button data-v="follow" class="${c.mode === 'follow' ? 'on' : ''}">${ICON.face}Follow face</button>
      <button data-v="center" class="${c.mode === 'center' ? 'on' : ''}">${ICON.center}Centre</button>
      <button data-v="fit" class="${c.mode === 'fit' ? 'on' : ''}">${ICON.fit}Whole frame</button></div>
      <small class="muted" id="face-note">${c.mode !== 'follow' ? '' : !c.keys ? 'Looking for faces…' : c.faceShare < 0.25 ? 'Few faces found. “Whole frame” may look better.' : 'Moves only when the speaker does, and cuts with the video.'}</small></div>` : ''}
    <div class="field"><div class="row"><span>Captions</span><label class="switch"><input type="checkbox" id="cc" ${p.captions ? 'checked' : ''}><i></i></label></div>
      <div class="styles ${p.captions ? '' : 'off'}" id="styles">${R.PRESETS.map((s) => `<button data-id="${s.id}" class="${p.style.preset === s.id ? 'on' : ''}"><canvas width="132" height="70"></canvas><span>${s.name}</span></button>`).join('')}</div>
      <small class="muted">Style applies to every clip.</small></div>
    <div class="side-foot">
      <button class="btn ghost" id="del">${ICON.trash}Remove clip</button>
      <button class="btn" id="export-one">${ICON.down}Export this clip</button>
    </div>`;
  $('#title').oninput = (e) => { c.title = e.target.value; const t = $(`.clip-card[data-id="${c.id}"] .ctitle`); if (t) t.textContent = c.title; save(); };
  $$('#mode button').forEach((b) => { b.onclick = () => { c.mode = b.dataset.v; save(); renderSide(); drawPreview(true); thumbFor(c); }; });
  $('#cc').onchange = (e) => { p.captions = e.target.checked; window.cs.setSettings({ captions: p.captions }); save(); $('#styles').classList.toggle('off', !p.captions); drawPreview(true); };
  $$('#styles button').forEach((b) => { b.onclick = () => {
    p.style = R.fromPreset(b.dataset.id); p.captions = true; window.cs.setSettings({ style: b.dataset.id }); save();
    pv && (pv.caps = clipCaptions(c)); renderSide(); drawPreview(true);
  }; });
  fontsReady.then(() => $$('#styles button').forEach((b) => drawStyleChip($('canvas', b), b.dataset.id)));
  $('#del').onclick = () => removeClip(c);
  $('#export-one').onclick = () => exportClips([c]);
}
function drawStyleChip(cv, id) {
  const g = cv.getContext('2d'); const st = R.fromPreset(id);
  g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, cv.width, cv.height);
  // A zoomed-in band of a 9:16 frame, so the type is readable at chip size.
  const W = 540; const H = 286;
  const cap = { start: 0, end: 3, text: 'Best part', words: [{ text: 'Best', start: 0, end: 0.4 }, { text: 'part', start: 0.4, end: 3 }], lineBreaks: [] };
  g.save(); g.scale(cv.width / W, cv.height / H);
  R.drawFrame(g, cap, { ...st, size: st.size * 1.5 * W / H, outline: st.outline * 1.5 * W / H, shadow: st.shadow * 1.5 * W / H, glow: st.glow * 1.5 * W / H, position: 'middle', margin: 50, maxChars: 40, maxLines: 1, maxWords: 0 }, 0.2, { W, H, measure, noSpace: false });
  g.restore();
}
function removeClip(c) {
  const p = current.project; const i = p.clips.indexOf(c);
  p.clips.splice(i, 1); save();
  current.sel = p.clips[Math.min(i, p.clips.length - 1)] ? p.clips[Math.min(i, p.clips.length - 1)].id : null;
  renderClips();
  toast('Clip removed.', { action: 'Undo', onAction: () => { p.clips.splice(i, 0, c); current.sel = c.id; save(); renderClips(); } });
}

// ---------- Export ----------
let exporting = null;
async function exportClips(list) {
  if (exporting || !list.length) return;
  const folder = await window.cs.pickFolder();
  if (!folder) return;
  state.settings.outDir = folder;
  const { media, project } = current;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-back';
  sheet.innerHTML = `<div class="sheet card"><b id="ex-title">Exporting ${list.length} clip${list.length > 1 ? 's' : ''}</b><div class="bar big"><i id="ex-bar"></i></div><span class="muted" id="ex-note"></span>${WEB ? '<span class="muted fine-sm">Clips record in real time. Keep this tab open and in front.</span>' : ''}<div class="sheet-foot"><button class="btn ghost" id="ex-cancel">Cancel</button></div></div>`;
  document.body.append(sheet);
  let stop = false; const done = [];
  $('#ex-cancel', sheet).onclick = () => { stop = true; if (exporting) window.cs.cancelJob(exporting.jobId); };
  try {
    for (let k = 0; k < list.length && !stop; k++) {
      const c = list[k];
      if (c.mode === 'follow' && !c.keys) { $('#ex-note', sheet).textContent = 'Finding faces first…'; await scanFaces(); }
      $('#ex-note', sheet).textContent = `${k + 1} of ${list.length}: ${c.title}`;
      const jobId = uid();
      exporting = { jobId, onPct: (pct) => { $('#ex-bar', sheet).style.width = `${(100 * (k + pct / 100) / list.length).toFixed(1)}%`; } };
      const ass = project.captions ? R.toASS(clipCaptions(c), project.style, { width: OUT_W, height: OUT_H, measure, noSpace: project.noSpace }) : '';
      const n = project.clips.indexOf(c) + 1;
      if (WEB) { const name = await webExport(c, exporting.onPct, () => stop); if (name) done.push(name); continue; }
      const out = await window.cs.exportClip({ jobId, file: media.file, info: media.info, folder, clip: { start: c.start, end: c.end, mode: c.mode === 'center' ? 'follow' : c.mode, keys: c.mode === 'center' ? [{ t: 0, cx: 0.5 }] : c.keys, ass, name: `${String(n).padStart(2, '0')} ${c.title}` } });
      done.push(out);
    }
    sheet.remove();
    if (done.length) toast(WEB ? `Downloaded ${done.length} clip${done.length > 1 ? 's' : ''}.` : `Saved ${done.length} clip${done.length > 1 ? 's' : ''}.`, WEB ? { kind: 'ok' } : { kind: 'ok', action: 'Show', onAction: () => window.cs.showInFolder(done[0]), ms: 9000 });
  } catch (e) {
    sheet.remove();
    if (!stop) toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { kind: 'bad', ms: 9000 });
    else if (done.length) toast(`Stopped. Saved ${done.length}.`, { action: 'Show', onAction: () => window.cs.showInFolder(done[0]) });
  } finally { exporting = null; }
}

// ---------- Web version: export by recording the 9:16 canvas while the clip plays ----------
// Same framing and captions as the preview (and the app). Plays in real time, sound included.
const WEB = !!window.cs.web;
async function webExport(c, onPct, isStopped) {
  const { media, project } = current;
  const caps = project.captions ? clipCaptions(c) : [];
  const v = document.createElement('video');
  v.src = media.file; v.preload = 'auto'; v.playsInline = true;
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error("Couldn't read the video.")); });
  v.currentTime = c.start; await new Promise((r) => { v.onseeked = r; });
  const cv = document.createElement('canvas'); cv.width = OUT_W; cv.height = OUT_H;
  const g = cv.getContext('2d');
  const ac = new AudioContext();
  const src = ac.createMediaElementSource(v); const dest = ac.createMediaStreamDestination(); src.connect(dest);
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192e3 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const draw = () => {
    const tc = Math.max(0, v.currentTime - c.start);
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawFramed(g, v, c, tc, OUT_W, OUT_H);
    const cap = caps.find((k) => tc >= k.start && tc < k.end);
    if (cap) R.drawFrame(g, cap, project.style, tc, { W: OUT_W, H: OUT_H, measure, noSpace: project.noSpace });
    onPct(100 * tc / (c.end - c.start));
  };
  draw();
  rec.start(1000);
  await ac.resume();
  await v.play();
  await new Promise((res) => {
    const step = () => {
      if (isStopped() || v.ended || v.currentTime >= c.end) return res();
      draw();
      v.requestVideoFrameCallback(step);
    };
    v.requestVideoFrameCallback(step);
    v.addEventListener('ended', res, { once: true });
  });
  v.pause(); draw();
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.stop(); await stopped;
  ac.close(); v.removeAttribute('src'); v.load();
  if (isStopped()) return null;
  const blob = new Blob(chunks, { type: type.split(';')[0] });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${c.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Clip'}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return a.download;
}

// Keyboard: space plays, up/down moves between clips.
window.addEventListener('keydown', (e) => {
  if (!current || !current.project || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); const b = $('#pp'); if (b) b.click(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const cl = current.project.clips; const i = cl.findIndex((c) => c.id === current.sel);
    const n = cl[Math.max(0, Math.min(cl.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { select(n.id); const el = $(`.clip-card[data-id="${n.id}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }
});

window.__cs = { get current() { return current; }, openVideo, openLink, exportClips };
boot();
