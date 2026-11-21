// Clipshaper in the browser. The desktop window talks to its computer through `window.cs`;
// this file provides the same `window.cs`, backed by the browser instead:
//   speech   → Whisper in a worker (speech-worker.js)
//   moments  → a small Qwen model on the GPU via WebLLM (skipped without WebGPU: quick picks)
//   faces    → MediaPipe, same as the app
//   export   → the page records its own 9:16 canvas (see exportClips in app.js)
// The video file is never uploaded. Models download once from Hugging Face and the browser keeps them.
(function () {
  const VERSION = '0.1.0';
  const LLM_LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/+esm';
  const LLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

  const listeners = {};
  const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); };
  const emit = (ch, d) => (listeners[ch] || []).forEach((f) => f(d));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const settings = Object.assign({ theme: 'dark', style: 'highlight', captions: true, language: 'auto' }, store.get('clipshaper.settings', {}));
  const blobs = new Map(); // blob URL → File
  const jobs = new Map(); // jobId → { cancelled, stop() }
  const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });

  let gpuP = null;
  const hasGpu = () => gpuP || (gpuP = (async () => { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } })());

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  const once = (el, ev) => new Promise((res, rej) => { el.addEventListener(ev, res, { once: true }); el.addEventListener('error', () => rej(new Error("This browser can't play that file. Try an MP4.")), { once: true }); });

  async function openMedia(file) {
    if (!(file instanceof Blob)) throw new Error('Choose a video file.');
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.src = url;
    await once(v, 'loadedmetadata');
    if (!v.videoWidth) throw new Error('This file has no picture. Clipshaper needs a video.');
    blobs.set(url, file);
    const id = hash(`${file.name}|${file.size}|${file.lastModified}`);
    const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, fps: 30, hasVideo: true, hasAudio: true };
    v.removeAttribute('src'); v.load();
    return { file: url, name: file.name, id, info, project: store.get(`clipshaper.p.${id}`, null) };
  }

  // 16 kHz mono, which is what Whisper wants. The browser resamples while decoding.
  async function decodeAudio(url) {
    const file = blobs.get(url);
    const buf = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    let decoded;
    try { decoded = await ctx.decodeAudioData(buf); } catch (e) { throw new Error("This video has no sound the browser can read. Try an MP4, or use the app."); }
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
    const out = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) { const d = decoded.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / decoded.numberOfChannels; }
    return out;
  }

  function listen(jobId, audio, language, gpu) {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('speech-worker.js', document.currentScript ? document.currentScript.src : location.href), { type: 'module' });
      const words = [];
      const job = jobs.get(jobId);
      job.stop = () => { w.terminate(); reject(cancelled()); };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'load') emit('job-progress', { jobId, stage: 'listen', pct: 0, note: m.pct < 100 ? `Getting the speech model (${m.mb || 110} MB, once): ${Math.round(m.pct)}%` : 'Writing down every word' });
        if (m.type === 'words') { words.push(...m.words); emit('job-progress', { jobId, stage: 'listen', pct: m.pct, words: m.words.length }); }
        if (m.type === 'done') { w.terminate(); resolve(words); }
        if (m.type === 'error') { w.terminate(); reject(new Error(`Speech recognition failed: ${m.message}`)); }
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(`Speech recognition failed: ${e.message || 'unknown error'}`)); };
      w.postMessage({ audio, gpu, language }, [audio.buffer]);
    });
  }

  let engine = null;
  async function momentFinder(jobId) {
    const webllm = await import(LLM_LIB);
    if (!engine) {
      engine = await webllm.CreateMLCEngine(LLM_MODEL, {
        initProgressCallback: (r) => {
          const fetching = /Fetching|Loading model from cache/.test(r.text) && r.progress < 1;
          emit('job-progress', { jobId, stage: 'moments', pct: 0, note: fetching ? `Getting the moment finder (900 MB, once): ${Math.round(r.progress * 100)}%` : 'Reading the whole thing like an editor' });
        },
      });
    }
    return async ({ system, user, schema }) => {
      const r = await engine.chat.completions.create({
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.3, max_tokens: 600,
        response_format: { type: 'json_object', schema: JSON.stringify(schema) },
      });
      return JSON.parse(r.choices[0].message.content);
    };
  }

  async function analyze({ jobId, file, language, info }) {
    const job = { cancelled: false, stop: () => {} }; jobs.set(jobId, job);
    try {
      const gpu = await hasGpu();
      emit('job-progress', { jobId, stage: 'listen', pct: 0, note: 'Reading the sound' });
      const audio = await decodeAudio(file);
      if (job.cancelled) throw cancelled();
      const words = await listen(jobId, audio, language, gpu);
      if (job.cancelled) throw cancelled();
      emit('job-progress', { jobId, stage: 'moments', pct: 0 });
      let ask = null;
      if (gpu && words.length > 30) {
        try { ask = await momentFinder(jobId); } catch (e) { console.warn('moment finder unavailable', e); }
      }
      if (job.cancelled) throw cancelled();
      job.stop = () => { try { engine && engine.interruptGenerate(); } catch (e) { /* fine */ } };
      const found = await window.Moments.find(words, {
        duration: info.duration, ask, span: 180, overlap: 30,
        signal: { get aborted() { return job.cancelled; } },
        onProgress: (p) => emit('job-progress', { jobId, stage: 'moments', pct: p, note: 'Reading the whole thing like an editor' }),
      });
      return { language: language && language !== 'auto' ? language : 'en', noSpace: false, words, duration: info.duration, clips: found.clips, method: found.method, cuts: [] };
    } finally { jobs.delete(jobId); }
  }

  // Small frames of one stretch for the face finder: seek a hidden video and grab each frame.
  let frameVideo = null;
  async function frames({ file, start, end, fps }) {
    if (!frameVideo || frameVideo.dataset.src !== file) {
      frameVideo = document.createElement('video'); frameVideo.muted = true; frameVideo.preload = 'auto'; frameVideo.src = file; frameVideo.dataset.src = file;
      await once(frameVideo, 'loadedmetadata');
    }
    const v = frameVideo;
    const H = 360; const W = Math.round(v.videoWidth * H / v.videoHeight / 2) * 2;
    const cv = new OffscreenCanvas(W, H); const g = cv.getContext('2d');
    const out = [];
    for (let t = start, i = 0; t < end; t = start + (++i) / fps) {
      await new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 3000); });
      g.drawImage(v, 0, 0, W, H);
      out.push({ t: i / fps, jpg: await cv.convertToBlob({ type: 'image/jpeg', quality: 0.75 }) });
    }
    return out;
  }

  window.cs = {
    web: true, platform: 'web', version: VERSION,
    facesBase: new URL('faces', location.href).href,
    assetsBase: 'assets',
    pathFor: (f) => f,
    fileUrl: (p) => p,
    hasGpu,
    getState: async () => ({ settings, recent: [], version: VERSION, platform: 'web', models: [{ id: 'speech', installed: true, size: 0 }, { id: 'moments', installed: true, size: 0 }] }),
    setSettings: async (p) => { Object.assign(settings, p); store.set('clipshaper.settings', settings); return settings; },
    pickVideo: () => new Promise((res) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*,.mkv,.mov';
      i.onchange = () => res(i.files[0] || null); i.addEventListener('cancel', () => res(null)); i.click();
    }),
    pickFolder: async () => 'downloads',
    openMedia,
    saveProject: async ({ id, project }) => store.set(`clipshaper.p.${id}`, project),
    models: async () => [{ id: 'speech', installed: true, size: 0 }, { id: 'moments', installed: true, size: 0 }],
    downloadModel: async () => true, cancelDownload: async () => true,
    analyze, frames,
    downloadLink: async () => { throw new Error('Links work in the free app.'); },
    browsers: async () => [],
    cancelJob: async (id) => { const j = jobs.get(id); if (j) { j.cancelled = true; j.stop(); } return true; },
    showInFolder: async () => {}, openPath: async () => {},
    openExternal: async (u) => { window.open(u, '_blank', 'noopener'); },
    checkUpdates: async () => null,
    rendererReady: async () => [],
    onUpdate: on('update'), onProgress: on('job-progress'), onModelProgress: on('model-progress'), onOpenFiles: on('open-files'), onFullscreen: on('fullscreen'),
  };
}());
