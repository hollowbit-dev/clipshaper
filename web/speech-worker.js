// Speech recognition for the web version, off the main thread: Whisper (base) through
// transformers.js, on the GPU with WebGPU or on the CPU with WebAssembly. Audio is cut into
// ~28 s pieces at the quietest moment near each boundary, so there's no overlap to merge and the
// page can show words as they arrive. Nothing leaves the browser; the model comes from Hugging Face once.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
const MODEL = 'onnx-community/whisper-base_timestamped';
const SR = 16000;

let asr = null;
async function load(gpu) {
  if (asr) return asr;
  const { pipeline } = await import(LIB);
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', MODEL, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let a = 0; let b = 0; for (const [x, y] of files.values()) { a += x; b += y; }
        postMessage({ type: 'load', pct: (100 * a) / b, mb: Math.round(b / 1e6) });
      }
    },
  });
  return asr;
}

// Cut points every ~28 s, moved to the quietest 50 ms within ±4 s.
function pieces(audio) {
  const out = []; let a = 0;
  while (a < audio.length) {
    let b = a + 28 * SR;
    if (b >= audio.length - 4 * SR) { out.push([a, audio.length]); break; }
    let best = b; let bestE = Infinity;
    const win = 0.05 * SR;
    for (let c = b - 4 * SR; c < b + 4 * SR; c += win) {
      let e = 0; for (let i = c; i < c + win; i += 4) e += audio[i] * audio[i];
      if (e < bestE) { bestE = e; best = c + win / 2; }
    }
    out.push([a, Math.floor(best)]); a = Math.floor(best);
  }
  return out;
}

const silent = (x) => { let e = 0; for (let i = 0; i < x.length; i += 8) e += x[i] * x[i]; return e / (x.length / 8) < 1e-6; };

onmessage = async (e) => {
  const { audio, gpu, language } = e.data;
  try {
    const run = await load(gpu);
    postMessage({ type: 'load', pct: 100 });
    const parts = pieces(audio);
    for (let k = 0; k < parts.length; k++) {
      const [a, b] = parts[k];
      const piece = audio.subarray(a, b);
      let words = [];
      if (!silent(piece)) {
        const r = await run(piece, { return_timestamps: 'word', ...(language && language !== 'auto' ? { language } : {}) });
        const off = a / SR; const len = (b - a) / SR;
        words = (r.chunks || []).map((c) => ({ text: c.text.trim(), start: off + Math.max(0, Math.min(len, c.timestamp[0] ?? 0)), end: off + Math.max(0, Math.min(len, c.timestamp[1] ?? c.timestamp[0] ?? 0)), p: 1 }))
          .filter((w) => w.text && !/^\[.*\]$|^\(.*\)$/.test(w.text));
        for (const w of words) if (w.end <= w.start) w.end = w.start + 0.12;
      }
      postMessage({ type: 'words', words, pct: (100 * b) / audio.length });
    }
    postMessage({ type: 'done' });
  } catch (err) {
    postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
