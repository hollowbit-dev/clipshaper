// Turns a wide video into a tall one by moving a 9:16 window over it, following faces.
// Input: face boxes found in frames sampled a few times a second (0..1 coords), and the times of
// hard cuts. Output: a path of keyframes { t, cx } (crop centre, 0..1 of the source width) that
// holds still when it can, glides when it must, and jumps only on a cut, like a camera operator.
// Shared by the main process (export) and the window (preview), so both frame the same.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reframe = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Width of the crop as a share of the source width, for an output aspect (w/h).
  function cropShare(srcW, srcH, aspect = 9 / 16) {
    return clamp((srcH * aspect) / srcW, 0, 1);
  }

  function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }

  // Which face to follow in each sample: the biggest, but stick with the one we had if it's close.
  function targets(samples, share) {
    let prev = null;
    return samples.map((s) => {
      const faces = (s.faces || []).filter((f) => f.score >= 0.5 && f.w > 0.025);
      if (!faces.length) return { t: s.t, cx: null };
      let best = null; let bestV = -1;
      for (const f of faces) {
        const cx = f.x + f.w / 2;
        let v = f.w * f.h * (0.6 + 0.4 * f.score);
        if (prev != null && Math.abs(cx - prev) < share * 0.5) v *= 1.8; // continuity
        if (v > bestV) { bestV = v; best = cx; }
      }
      prev = best;
      return { t: s.t, cx: best };
    });
  }

  // samples: [{ t, faces: [{ x, y, w, h, score }] }] sorted by t (seconds, clip-relative)
  // cuts: [t] hard cut times. Returns [{ t, cx }] with a key on both sides of every cut.
  function path(samples, cuts, { srcW, srcH, aspect = 9 / 16, duration } = {}) {
    const share = cropShare(srcW, srcH, aspect);
    if (share >= 0.999 || !samples.length) return [{ t: 0, cx: 0.5 }];
    const lo = share / 2; const hi = 1 - share / 2;
    const end = duration != null ? duration : samples[samples.length - 1].t;
    const edges = [0, ...cuts.filter((c) => c > 0.05 && c < end - 0.05).sort((a, b) => a - b), end];
    const tg = targets(samples, share);
    const keys = [];
    for (let k = 0; k < edges.length - 1; k++) {
      const a = edges[k]; const b = edges[k + 1];
      const shot = tg.filter((s) => s.t >= a - 1e-6 && s.t < b + (k === edges.length - 2 ? 1e-6 : 0));
      const seen = shot.filter((s) => s.cx != null);
      // No face in the whole shot: keep the middle.
      if (!seen.length) { keys.push({ t: a, cx: 0.5 }, { t: b, cx: 0.5, end: true }); continue; }
      // Fill gaps with the nearest seen value, then a 5-sample median against jitter.
      let last = seen[0].cx;
      const filled = shot.map((s) => { if (s.cx != null) last = s.cx; return { t: s.t, cx: last }; });
      const med = filled.map((s, i) => ({ t: s.t, cx: median(filled.slice(Math.max(0, i - 2), i + 3).map((x) => x.cx)) }));
      const span = Math.max(...med.map((s) => s.cx)) - Math.min(...med.map((s) => s.cx));
      if (span < share * 0.4) {
        // The subject stays inside one framing: lock off, like a tripod shot.
        const c = clamp(median(med.map((s) => s.cx)), lo, hi);
        keys.push({ t: a, cx: c }, { t: b, cx: c, end: true });
        continue;
      }
      // Otherwise follow with a dead zone and a speed limit, then smooth both ways.
      let cam = clamp(med[0].cx, lo, hi);
      const dz = share * 0.14; const maxSpeed = share * 0.9; // share-widths per second
      const raw = med.map((s, i) => {
        const dt = i ? s.t - med[i - 1].t : 0;
        const want = clamp(s.cx, lo, hi);
        const off = want - cam;
        if (Math.abs(off) > dz) {
          const step = clamp((Math.abs(off) - dz * 0.5) * Math.sign(off), -maxSpeed * dt, maxSpeed * dt);
          cam = clamp(cam + step, lo, hi);
        }
        return cam;
      });
      const sm = raw.slice();
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < sm.length; i++) sm[i] = sm[i - 1] + (sm[i] - sm[i - 1]) * 0.35;
        for (let i = sm.length - 2; i >= 0; i--) sm[i] = sm[i + 1] + (sm[i] - sm[i + 1]) * 0.35;
      }
      keys.push({ t: a, cx: sm[0] });
      med.forEach((s, i) => { if (s.t > a + 1e-3 && s.t < b - 1e-3) keys.push({ t: s.t, cx: sm[i] }); });
      keys.push({ t: b, cx: sm[sm.length - 1], end: true });
    }
    return keys;
  }

  // Crop centre at time t. A key marked `end` closes its shot, so a cut jumps instead of gliding.
  function at(keys, t) {
    if (!keys.length) return 0.5;
    if (t <= keys[0].t) return keys[0].cx;
    for (let i = 1; i < keys.length; i++) {
      const k0 = keys[i - 1]; const k1 = keys[i];
      if (t < k1.t || (t === k1.t && !k1.end)) {
        if (k0.end) return k1.cx;
        const u = (t - k0.t) / Math.max(1e-6, k1.t - k0.t);
        const e = u * u * (3 - 2 * u);
        return k0.cx + (k1.cx - k0.cx) * e;
      }
    }
    return keys[keys.length - 1].cx;
  }

  // ffmpeg sendcmd script that moves crop's x (in pixels) every frame-ish step.
  function sendcmd(keys, { srcW, cropW, duration, step = 1 / 30 }) {
    const lines = [];
    let prev = null;
    for (let t = 0; t <= duration + 1e-6; t += step) {
      const x = Math.round(clamp(at(keys, t) * srcW - cropW / 2, 0, srcW - cropW));
      if (x !== prev) { lines.push(`${t.toFixed(4)} crop x ${x};`); prev = x; }
    }
    return lines.join('\n') + '\n';
  }

  return { cropShare, targets, path, at, sendcmd };
}));
