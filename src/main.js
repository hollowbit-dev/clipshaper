// Clipshaper — main process. Window, local file serving, and the clip pipeline:
// listen (whisper.cpp) → pick moments (llama.cpp + a small local model) → find cuts → export
// vertical captioned clips (ffmpeg). Video never leaves this computer. The only network requests
// are the one-time model downloads from Hugging Face, which the user starts, and the daily
// version check, which can be turned off.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { transcribe } = require('./core/transcribe');
const moments = require('./core/moments');
const Reframe = require('./core/reframe');
const llm = require('./core/llm');
const { createLinks, looksLikeLink } = require('./core/links');
const store = require('./store');
const { setupUpdates } = require('./update-check');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
if (process.env.CLIPSHAPER_USERDATA) app.setPath('userData', process.env.CLIPSHAPER_USERDATA);
if (process.env.CLIPSHAPER_SCALE) app.commandLine.appendSwitch('force-device-scale-factor', process.env.CLIPSHAPER_SCALE);
const appRoot = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([{
  scheme: 'clipshaper',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// ---------- Bundled tools ----------
const plat = `${process.platform}-${process.arch}`;
const bins = app.isPackaged ? {
  ffmpeg: path.join(process.resourcesPath, 'ffmpeg', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
  whisperDir: path.join(process.resourcesPath, 'whisper'),
  vadModel: path.join(process.resourcesPath, 'models', 'ggml-silero-v5.1.2.bin'),
} : {
  ffmpeg: path.join(appRoot, 'vendor', 'ffmpeg', plat, isWin ? 'ffmpeg.exe' : 'ffmpeg'),
  whisperDir: path.join(appRoot, 'vendor', 'whisper', plat),
  vadModel: path.join(appRoot, 'vendor', 'models', 'ggml-silero-v5.1.2.bin'),
};
const fontsDir = path.join(appRoot, 'assets', 'fonts');

// ---------- Models ----------
// Two downloads, once: a speech model and a small language model that picks the moments.
// If Captionshaper or Writeshaper already downloaded the same file, Clipshaper uses that copy.
const MODELS = [
  {
    id: 'speech', name: 'Speech', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin', sibling: 'Captionshaper',
  },
  {
    id: 'moments', name: 'Moments', file: 'Qwen3.5-4B-UD-IQ3_XXS.gguf', size: 1949047968,
    sha256: '00aab66a2359a9afc52f0ab757e61f9be1656e6fcaba8468bd95579a8b2cbc40',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-UD-IQ3_XXS.gguf', sibling: 'Writeshaper',
  },
];
const modelsDir = () => process.env.CLIPSHAPER_MODELS || path.join(app.getPath('userData'), 'models');
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch (e) { return -1; } };
function modelPath(m) {
  const own = path.join(modelsDir(), m.file);
  if (sizeOf(own) === m.size) return own;
  const sib = path.join(app.getPath('appData'), m.sibling, 'models', m.file);
  if (!process.env.CLIPSHAPER_MODELS && sizeOf(sib) === m.size) return sib;
  return null;
}
const downloads = new Map();
function modelState() {
  return MODELS.map((m) => ({ id: m.id, name: m.name, size: m.size, installed: !!modelPath(m), downloading: downloads.has(m.id), partial: Math.max(0, sizeOf(path.join(modelsDir(), m.file) + '.part')) }));
}
async function downloadModel(id) {
  const m = MODELS.find((x) => x.id === id);
  if (!m || downloads.has(id) || modelPath(m)) return;
  const ctrl = new AbortController();
  downloads.set(id, ctrl);
  fs.mkdirSync(modelsDir(), { recursive: true });
  const dest = path.join(modelsDir(), m.file);
  const part = dest + '.part';
  let last = 0;
  try {
    // Big downloads drop now and then: resume from where it stopped, a few times.
    for (let attempt = 0; ; attempt++) {
      let have = Math.max(0, sizeOf(part));
      if (have > m.size) { fs.rmSync(part, { force: true }); have = 0; }
      if (have === m.size) break;
      try {
        const res = await net.fetch(m.url, { signal: ctrl.signal, headers: have ? { Range: `bytes=${have}-` } : {} });
        if (have && res.status !== 206) { fs.rmSync(part, { force: true }); have = 0; }
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            have += value.length;
            if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
            const now = Date.now();
            if (now - last > 150) { last = now; send('model-progress', { id, got: have, total: m.size }); }
          }
        } finally { await new Promise((r) => out.end(r)); }
      } catch (e) {
        if (ctrl.signal.aborted || attempt >= 6) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    send('model-progress', { id, got: m.size, total: m.size, verifying: true });
    const hash = crypto.createHash('sha256');
    await new Promise((r, j) => fs.createReadStream(part).on('data', (d) => hash.update(d)).on('end', r).on('error', j));
    if (hash.digest('hex') !== m.sha256) { fs.rmSync(part, { force: true }); throw new Error('The download was damaged. Please try again.'); }
    fs.renameSync(part, dest);
    send('model-progress', { id, got: m.size, total: m.size, done: true });
  } catch (e) {
    // A cancelled download keeps its .part file, so the next try resumes.
    send('model-progress', { id, error: ctrl.signal.aborted ? 'cancelled' : e.message });
  } finally {
    downloads.delete(id);
  }
}

// ---------- Local files ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};
function serveFile(file, request) {
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (!m || start >= stat.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    end = Math.min(end, stat.size - 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(stat.size) } });
}
// Only files the user opened (and the app's own files) can be served.
const allowed = new Set();
const faceFiles = {
  wasm: app.isPackaged ? path.join(process.resourcesPath, 'faces') : path.join(appRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
  model: app.isPackaged ? path.join(process.resourcesPath, 'faces', 'blaze_face_short_range.tflite') : path.join(appRoot, 'vendor', 'models', 'blaze_face_short_range.tflite'),
  lib: app.isPackaged ? path.join(process.resourcesPath, 'faces', 'vision_bundle.mjs') : path.join(appRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'vision_bundle.mjs'),
};
function registerProtocol() {
  protocol.handle('clipshaper', (request) => {
    const url = new URL(request.url);
    if (url.host === 'app') {
      const p = path.normalize(path.join(appRoot, decodeURIComponent(url.pathname)));
      if (!p.startsWith(path.join(appRoot, 'src')) && !p.startsWith(path.join(appRoot, 'assets'))) return new Response('Forbidden', { status: 403 });
      return serveFile(p, request);
    }
    if (url.host === 'faces') {
      const name = path.basename(decodeURIComponent(url.pathname));
      if (name === 'model.tflite') return serveFile(faceFiles.model, request);
      if (name === 'vision_bundle.mjs') return serveFile(faceFiles.lib, request);
      if (/^vision_wasm_internal\.(js|wasm)$/.test(name)) return serveFile(path.join(faceFiles.wasm, name), request);
      return new Response('Not found', { status: 404 });
    }
    if (url.host === 'file') {
      const p = decodeURIComponent(url.pathname.slice(1));
      if (!allowed.has(p)) return new Response('Forbidden', { status: 403 });
      return serveFile(p, request);
    }
    return new Response('Not found', { status: 404 });
  });
}

// ---------- ffmpeg ----------
function ffmpeg(args, { duration = 0, onProgress = () => {}, signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bins.ffmpeg, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true, cwd });
    let tail = ''; let buf = '';
    p.stdout.on('data', (d) => {
      buf += d; const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && duration > 0) onProgress(Math.min(99.5, (parseInt(m[1], 10) / 1e6 / duration) * 100));
      }
    });
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-4000); });
    const abort = () => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } };
    if (signal) { if (signal.aborted) abort(); signal.addEventListener('abort', abort, { once: true }); }
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (code === 0) { onProgress(100); resolve(); } else reject(new Error(tail.trim().split('\n').slice(-3).join('\n') || `ffmpeg exited with ${code}`));
    });
  });
}
function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(bins.ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve({ duration: 0, hasVideo: false, hasAudio: false }));
    p.on('close', () => {
      const d = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(err);
      const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0;
      const videoLine = (err.match(/Stream #.*Video: .*/g) || []).find((l) => !/attached pic/.test(l));
      const audioLine = (err.match(/Stream #.*Audio: .*/g) || [])[0];
      let width = 0; let height = 0; let fps = 30;
      if (videoLine) {
        const s = /, (\d{2,5})x(\d{2,5})/.exec(videoLine); if (s) { width = +s[1]; height = +s[2]; }
        const f = /([\d.]+) fps/.exec(videoLine); if (f) fps = parseFloat(f[1]);
        if (/rotation of -?90|rotate\s*:\s*-?90|rotate\s*:\s*270/.test(err)) [width, height] = [height, width];
      }
      resolve({ duration, hasVideo: !!videoLine, hasAudio: !!audioLine, width, height, fps });
    });
  });
}

// Hard cuts in the whole video, from ffmpeg's scene score on a tiny copy of each frame.
function findCuts(file, { duration, signal, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const p = spawn(bins.ffmpeg, ['-hide_banner', '-nostats', '-progress', 'pipe:2', '-an', '-sn', '-dn', '-i', file,
      '-vf', "scale=160:-2,select='gt(scene,0.30)',metadata=print:file=-", '-f', 'null', '-'], { windowsHide: true });
    const cuts = []; let out = ''; let err = '';
    p.stdout.on('data', (d) => {
      out += d; const lines = out.split('\n'); out = lines.pop();
      for (const l of lines) { const m = /pts_time:([\d.]+)/.exec(l); if (m) cuts.push(parseFloat(m[1])); }
    });
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-3000);
      const m = /out_time_us=(\d+)/.exec(String(d)); if (m && duration) onProgress(Math.min(99, (+m[1] / 1e6 / duration) * 100));
    });
    const abort = () => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      // A failed cut search is not fatal: clips just won't jump on cuts.
      resolve(code === 0 ? cuts : []);
    });
  });
}

// Small JPEG frames of one stretch, for the face finder in the window.
function framesFor(file, { start, end, fps = 3, height = 360 }) {
  return new Promise((resolve, reject) => {
    const p = spawn(bins.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-to', String(end), '-an', '-sn', '-i', file,
      '-vf', `fps=${fps},scale=-2:${height}`, '-q:v', '5', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', () => {
      const all = Buffer.concat(chunks);
      const frames = [];
      let a = 0;
      // Split the stream at JPEG start markers.
      for (let i = 2; i < all.length - 1; i++) {
        if (all[i] === 0xff && all[i + 1] === 0xd8 && all[i - 2] === 0xff && all[i - 1] === 0xd9) { frames.push(all.subarray(a, i)); a = i; }
      }
      if (all.length > a) frames.push(all.subarray(a));
      resolve(frames.map((buf, i) => ({ t: i / fps, jpg: buf })));
    });
  });
}

// ---------- Projects (kept per video, so reopening shows the same clips and edits) ----------
const projectsDir = () => path.join(app.getPath('userData'), 'projects');
function projectId(file) {
  const st = fs.statSync(file);
  return crypto.createHash('sha1').update(`${file}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16);
}

// ---------- Window ----------
let win;
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function createWindow() {
  nativeTheme.themeSource = store.settings.theme || 'dark';
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1000, minHeight: 660, title: 'Clipshaper',
    backgroundColor: '#0b0c0e',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#ececef', height: 44 } }),
    icon: path.join(appRoot, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const sendFs = () => send('fullscreen', win.isFullScreen());
  win.on('enter-full-screen', sendFs); win.on('leave-full-screen', sendFs);
  win.loadURL('clipshaper://app/src/renderer/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('clipshaper://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

let pendingOpen = [];
let rendererReady = false;
app.on('open-file', (e, file) => { e.preventDefault(); if (win && rendererReady) send('open-files', [file]); else pendingOpen.push(file); });

const jobs = new Map();
const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });

function safeName(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Clip'; }

// The ffmpeg filter that turns the source into a 1080×1920 clip.
//   follow: a 9:16 window that moves along the face path (sendcmd file)
//   fit:    the whole frame in the middle over a blurred, zoomed copy of itself
function clipFilter(info, mode, hasSubs) {
  const W = info.width - (info.width % 2); const H = info.height - (info.height % 2);
  const share = Reframe.cropShare(W, H);
  const subs = hasSubs ? ',ass=subs.ass:fontsdir=fonts' : '';
  if (share >= 0.999) {
    // Already tall (or square-ish narrower than 9:16): fill and centre.
    return `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${subs}`;
  }
  if (mode === 'fit') {
    return `split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.06:saturation=1.1[bg];`
      + `[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${subs}`;
  }
  const cw = Math.round(H * 9 / 16 / 2) * 2;
  return `sendcmd=f=crop.cmd,crop=${cw}:${H}:0:0,scale=1080:1920:flags=lanczos,setsar=1${subs}`;
}

function registerIpc() {
  ipcMain.handle('renderer-ready', () => { rendererReady = true; const f = pendingOpen; pendingOpen = []; return f; });
  ipcMain.handle('get-state', () => ({ settings: store.settings, recent: store.recent, version: app.getVersion(), models: modelState(), platform: process.platform }));
  ipcMain.handle('set-settings', (_e, patch) => { store.setSettings(patch); if (patch.theme) nativeTheme.themeSource = patch.theme; return store.settings; });
  ipcMain.handle('pick-video', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('open-media', async (_e, file, title) => {
    if (!file || !fs.existsSync(file)) throw new Error('That file is no longer there.');
    allowed.add(file);
    const info = await probe(file);
    if (!info.hasVideo) throw new Error('This file has no picture. Clipshaper needs a video.');
    if (!info.hasAudio) throw new Error('This video has no sound, so there is nothing to find moments in.');
    const id = projectId(file);
    let project = null;
    try { project = JSON.parse(fs.readFileSync(path.join(projectsDir(), `${id}.json`), 'utf8')); } catch (e) { /* new */ }
    const name = title || path.basename(file);
    store.addRecent({ file, name, duration: info.duration, at: Date.now(), id });
    return { file, name, id, info, project };
  });
  ipcMain.handle('save-project', (_e, { id, project }) => {
    fs.mkdirSync(projectsDir(), { recursive: true });
    fs.writeFileSync(path.join(projectsDir(), `${id}.json`), JSON.stringify(project));
    return true;
  });
  ipcMain.handle('models', () => modelState());
  ipcMain.handle('download-model', (_e, id) => { downloadModel(id); return true; });
  ipcMain.handle('cancel-download', (_e, id) => { const c = downloads.get(id); if (c) c.abort(); return true; });

  // The whole analysis, in one job: listen, then pick moments while ffmpeg looks for cuts.
  ipcMain.handle('analyze', async (_e, { jobId, file, language, info }) => {
    const speech = modelPath(MODELS[0]); const brain = modelPath(MODELS[1]);
    if (!speech) throw new Error('Download the speech model first.');
    const ctrl = new AbortController(); jobs.set(jobId, ctrl);
    const prog = (stage, pct, extra) => send('job-progress', { jobId, stage, pct, ...extra });
    try {
      const cutsP = findCuts(file, { duration: info.duration, signal: ctrl.signal });
      // Tests can hand in a saved transcript (and picks) instead of waiting minutes for them.
      const cache = process.env.CLIPSHAPER_CACHE && path.join(process.env.CLIPSHAPER_CACHE, path.basename(file).replace(/\.[^.]+$/, ''));
      const tr = cache && fs.existsSync(`${cache}.json`) ? JSON.parse(fs.readFileSync(`${cache}.json`, 'utf8')) : await transcribe(bins, {
        input: file, model: speech, language, signal: ctrl.signal,
        onProgress: (p) => prog('listen', p.stage === 'words' ? p.pct : 0, p.words ? { words: p.words.length } : {}),
      });
      if (ctrl.signal.aborted) throw cancelled();
      prog('moments', 0);
      let ask = null;
      if (brain) {
        try { if (!cache || !fs.existsSync(`${cache}.clips.json`)) { await llm.start(app, brain); ask = llm.ask; } } catch (e) { console.error('moment finder', e.message); }
      }
      let found;
      try {
        found = cache && fs.existsSync(`${cache}.clips.json`) ? { clips: JSON.parse(fs.readFileSync(`${cache}.clips.json`, 'utf8')), method: 'model' } : await moments.find(tr.words, { duration: tr.duration, ask, signal: ctrl.signal, onProgress: (p) => prog('moments', p) });
      } finally { llm.stop(); } // frees a couple of GB for the export
      prog('cuts', 50);
      const cuts = await cutsP;
      return { language: tr.language, noSpace: tr.noSpace, words: tr.words, duration: tr.duration, clips: found.clips, method: found.method, cuts };
    } finally { jobs.delete(jobId); }
  });
  // A link from YouTube, TikTok, Instagram, X, Twitch… downloaded into the app's folder first.
  ipcMain.handle('download-link', async (_e, { jobId, url, browser }) => {
    if (!looksLikeLink(url)) throw new Error("That doesn't look like a link.");
    const ctrl = new AbortController(); jobs.set(jobId, ctrl);
    try {
      const r = await links().download(url.trim(), {
        outDir: path.join(app.getPath('userData'), 'downloads'), signal: ctrl.signal, browser,
        onProgress: (p) => send('job-progress', { jobId, stage: p.stage === 'setup' ? 'fetch-setup' : 'fetch', pct: p.pct, title: p.title }),
      });
      return r;
    } finally { jobs.delete(jobId); }
  });
  // Browsers whose login a link can borrow, most common first.
  ipcMain.handle('browsers', () => {
    const mac = [['chrome', 'Google Chrome'], ['brave', 'Brave Browser'], ['edge', 'Microsoft Edge'], ['firefox', 'Firefox'], ['safari', 'Safari']];
    if (isMac) return mac.filter(([, n]) => fs.existsSync(`/Applications/${n}.app`) || fs.existsSync(path.join(os.homedir(), 'Applications', `${n}.app`))).map(([id, name]) => ({ id, name: name.replace('Google ', '').replace('Microsoft ', '').replace(' Browser', '') }));
    const la = process.env.LOCALAPPDATA || ''; const ad = process.env.APPDATA || '';
    const win = [['chrome', 'Chrome', path.join(la, 'Google', 'Chrome')], ['edge', 'Edge', path.join(la, 'Microsoft', 'Edge')], ['brave', 'Brave', path.join(la, 'BraveSoftware')], ['firefox', 'Firefox', path.join(ad, 'Mozilla', 'Firefox')]];
    return win.filter(([, , d]) => fs.existsSync(d)).map(([id, name]) => ({ id, name }));
  });
  ipcMain.handle('frames', (_e, { file, start, end, fps }) => framesFor(file, { start, end, fps }));
  ipcMain.handle('cancel-job', (_e, jobId) => { const c = jobs.get(jobId); if (c) c.abort(); return true; });

  ipcMain.handle('pick-folder', async () => {
    if (process.env.CLIPSHAPER_OUTDIR) return process.env.CLIPSHAPER_OUTDIR;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: store.settings.outDir || app.getPath('videos') });
    if (r.canceled) return null;
    store.setSettings({ outDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  // Export one clip ({ start, end, mode, keys, ass, name }) into `folder`.
  ipcMain.handle('export-clip', async (_e, { jobId, file, info, folder, clip }) => {
    const out = uniquePath(path.join(folder, `${safeName(clip.name)}.mp4`));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipshaper-'));
    const len = clip.end - clip.start;
    const W = info.width - (info.width % 2); const H = info.height - (info.height % 2);
    const cw = Math.round(H * 9 / 16 / 2) * 2;
    fs.writeFileSync(path.join(dir, 'crop.cmd'), Reframe.sendcmd(clip.keys || [{ t: 0, cx: 0.5 }], { srcW: W, cropW: cw, duration: len }));
    const hasSubs = !!clip.ass;
    if (hasSubs) {
      fs.writeFileSync(path.join(dir, 'subs.ass'), clip.ass, 'utf8');
      fs.mkdirSync(path.join(dir, 'fonts'));
      for (const f of fs.readdirSync(fontsDir)) if (f.endsWith('.ttf')) fs.copyFileSync(path.join(fontsDir, f), path.join(dir, 'fonts', f));
    }
    const ctrl = new AbortController(); jobs.set(jobId, ctrl);
    try {
      await ffmpeg(['-ss', clip.start.toFixed(3), '-i', file, '-t', len.toFixed(3), '-map', '0:a:0?',
        '-filter_complex', `[0:v]${clipFilter(info, clip.mode, hasSubs)}[v]`, '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(Math.min(60, Math.round(info.fps || 30))),
        '-c:a', 'aac', '-b:a', '192k', '-af', 'afade=t=in:d=0.08', '-movflags', '+faststart', out],
      { duration: len, cwd: dir, signal: ctrl.signal, onProgress: (pct) => send('job-progress', { jobId, stage: 'export', pct }) });
      return out;
    } catch (e) {
      try { fs.rmSync(out, { force: true }); } catch (x) { /* nothing */ }
      throw e;
    } finally { jobs.delete(jobId); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
  ipcMain.handle('open-external', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
  ipcMain.handle('check-updates', () => updates.check({ manual: true }));
}

let linksApi = null;
const links = () => linksApi || (linksApi = createLinks({ dir: path.join(app.getPath('userData'), 'bin'), ffmpeg: bins.ffmpeg, fetch: (u) => net.fetch(u) }));

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p); const base = p.slice(0, -ext.length);
  for (let i = 2; ; i++) { const q = `${base} (${i})${ext}`; if (!fs.existsSync(q)) return q; }
}

const updates = setupUpdates({
  app, repo: 'hollowbit-dev/clipshaper',
  getSettings: () => store.settings, setSettings: (p) => store.setSettings(p),
  send: (st) => { if (win && !win.isDestroyed()) win.webContents.send('update', st); },
});

app.whenReady().then(() => {
  store.load();
  registerProtocol();
  registerIpc();
  createWindow();
  if (!process.env.CLIPSHAPER_TEST) updates.schedule();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('before-quit', () => { llm.stop(); for (const c of jobs.values()) c.abort(); });
if (!isMac) {
  const f = process.argv.slice(1).find((a) => /\.(mp4|mov|m4v|mkv|webm)$/i.test(a));
  if (f) pendingOpen.push(f);
}
module.exports = { clipFilter };
