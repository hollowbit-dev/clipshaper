// Video links (YouTube, TikTok, Instagram, X, Twitch, Facebook, Vimeo and ~1,800 more) via yt-dlp.
// yt-dlp is fetched from its official GitHub release the first time a link is pasted, checked
// against the release's SHA-256 list, and kept up to date (sites change often and break it).
// Paths and the fetcher are passed in, so this also runs in plain node tests.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isWin = process.platform === 'win32';
const ASSET = isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const STALE_MS = 3 * 24 * 3600 * 1000;

function looksLikeLink(s) {
  const t = String(s || '').trim();
  if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(t)) return false;
  try { const u = new URL(t); return !!u.hostname; } catch (e) { return false; }
}

function createLinks({ dir, ffmpeg, fetch: get = fetch }) {
  const exe = path.join(dir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  const stamp = path.join(dir, 'yt-dlp.checked');
  let installing = null;

  const installed = () => fs.existsSync(exe);

  async function install(onProgress = () => {}) {
    if (installing) return installing;
    installing = (async () => {
      fs.mkdirSync(dir, { recursive: true });
      const sums = await (await get(BASE + 'SHA2-256SUMS')).text();
      const line = sums.split('\n').find((l) => l.trim().endsWith(` ${ASSET}`));
      if (!line) throw new Error('Could not check the link downloader. Please try again.');
      const want = line.trim().split(/\s+/)[0].toLowerCase();
      const res = await get(BASE + ASSET);
      if (!res.ok) throw new Error(`Could not get the link downloader (${res.status}).`);
      const total = +res.headers.get('content-length') || 0;
      const part = exe + '.part';
      const out = fs.createWriteStream(part);
      const hash = crypto.createHash('sha256');
      const reader = res.body.getReader();
      let got = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const b = Buffer.from(value); hash.update(b); got += b.length;
          if (!out.write(b)) await new Promise((r) => out.once('drain', r));
          if (total) onProgress(got / total);
        }
      } finally { await new Promise((r) => out.end(r)); }
      if (hash.digest('hex') !== want) { fs.rmSync(part, { force: true }); throw new Error('The link downloader was damaged in transit. Please try again.'); }
      fs.renameSync(part, exe);
      if (!isWin) fs.chmodSync(exe, 0o755);
      fs.writeFileSync(stamp, String(Date.now()));
    })();
    try { await installing; } finally { installing = null; }
  }

  function run(args, { signal, onLine } = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let out = ''; let err = ''; let buf = '';
      const feed = (d) => {
        buf += d; const lines = buf.split(/\r?\n|\r/); buf = lines.pop();
        for (const l of lines) if (onLine) onLine(l);
      };
      p.stdout.on('data', (d) => { out += d; feed(String(d)); });
      p.stderr.on('data', (d) => { err = (err + d).slice(-6000); feed(String(d)); });
      const abort = () => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } };
      if (signal) { if (signal.aborted) abort(); signal.addEventListener('abort', abort, { once: true }); }
      p.on('error', reject);
      p.on('close', (code) => {
        if (signal && signal.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
        if (code === 0) resolve(out); else reject(Object.assign(new Error(friendly(err)), { raw: err }));
      });
    });
  }

  // Sites change and break yt-dlp; it can replace itself with the newest release.
  async function update(force) {
    let last = 0; try { last = +fs.readFileSync(stamp, 'utf8'); } catch (e) { /* never */ }
    if (!force && Date.now() - last < STALE_MS) return;
    try { await run(['-U']); } catch (e) { /* offline or rate-limited: keep the old one */ }
    try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) { /* fine */ }
  }

  // Downloads one video (up to 1080p, as MP4) into `outDir`. Returns { file, title }.
  // `browser` (chrome, firefox, safari…) borrows that browser's login for sites that need one.
  // The cookies are read on this computer by yt-dlp and only sent to the video's own site.
  async function download(url, { outDir, signal, browser, onProgress = () => {} }) {
    if (!installed()) { onProgress({ stage: 'setup', pct: 0 }); await install((f) => onProgress({ stage: 'setup', pct: f * 100 })); }
    else await update();
    fs.mkdirSync(outDir, { recursive: true });
    const args = [
      '--no-playlist', '--no-warnings', '--newline', '--progress', '--color', 'no_color', '--no-mtime', '--restrict-filenames',
      '--ffmpeg-location', ffmpeg,
      '-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      '-o', path.join(outDir, '%(title).70B [%(id)s].%(ext)s'),
      '--progress-template', 'download:CSPROG %(progress._percent_str)s',
      '--print', 'after_move:CSFILE %(filepath)s', '--print', 'before_dl:CSTITLE %(title)s',
      ...(browser ? ['--cookies-from-browser', browser] : []),
      '--', url,
    ];
    let file = null; let title = null; let part = 0; let lastPct = 0;
    const onLine = (l) => {
      let m;
      if ((m = /^CSFILE (.+)$/.exec(l))) file = m[1].trim();
      else if ((m = /^CSTITLE (.+)$/.exec(l))) { title = m[1].trim(); onProgress({ stage: 'download', pct: 0, title }); }
      else if ((m = /CSPROG\s*([\d.]+)%/.exec(l))) {
        const pct = parseFloat(m[1]);
        if (pct < lastPct - 50) part++; // video done, audio starting
        lastPct = pct;
        onProgress({ stage: 'download', pct: Math.min(99, part ? 85 + pct * 0.14 : pct * 0.85), title });
      }
    };
    try {
      await run(args, { signal, onLine });
    } catch (e) {
      if (e.cancelled) throw e;
      // A broken extractor is usually fixed by the newest yt-dlp: update once and retry.
      if (/Unsupported URL|not a valid URL/i.test(e.raw || '')) throw e;
      await update(true);
      await run(args, { signal, onLine });
    }
    if (!file || !fs.existsSync(file)) throw new Error('The download finished but the video file is missing.');
    return { file, title: title || path.basename(file) };
  }

  return { installed, install, update, download };
}

function friendly(err) {
  const e = String(err);
  if (/Unsupported URL/i.test(e)) return "That link isn't a video Clipshaper can open.";
  if (/Private video|private/i.test(e) && /video/i.test(e)) return 'That video is private.';
  if (/could not find .* cookies|failed to decrypt|Operation not permitted.*Cookies|keyring/i.test(e)) return "Couldn't read that browser's login. Download the video yourself, then drop the file in.";
  if (/Sign in to confirm|login|log in|logged-in|cookies|empty media response|rate-limit/i.test(e)) return 'LOGIN: That site wants you to be logged in to get this video.';
  if (/members-only|Join this channel/i.test(e)) return 'That video is members-only.';
  if (/not available|unavailable|removed|404/i.test(e)) return "That video isn't available.";
  if (/is live|live event|premieres/i.test(e)) return "That stream hasn't finished yet. Try again once it's over.";
  if (/getaddrinfo|Unable to download webpage|timed out|Connection/i.test(e)) return "Couldn't reach the site. Check your internet connection.";
  const last = e.trim().split('\n').filter((l) => /ERROR/.test(l)).pop();
  return last ? last.replace(/^.*?ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '') : 'The download failed.';
}

module.exports = { createLinks, looksLikeLink, friendly };
