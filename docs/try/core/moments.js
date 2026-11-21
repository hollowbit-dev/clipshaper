// Finds the best moments in a long video's transcript.
// The transcript is split into sentences, sent in windows of a few minutes to a small local model
// that picks self-contained stretches with a strong opening line, and the picks are then snapped to
// sentence edges, held to clip-friendly lengths, de-duplicated and ranked.
// Pure functions except find(), which takes the model's `ask` function, so tests can fake it.
// Works in node (the app) and in the browser (the web version) alike.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Moments = factory();
}(typeof self !== 'undefined' ? self : this, () => {

const MIN_LEN = 15;
const MAX_LEN = 75;
const IDEAL = [25, 55];

// ---------- Sentences ----------
function sentences(words, { gap = 1.1, maxLen = 22 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'), w0: cur[0].i, w1: cur[cur.length - 1].i });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > gap || w.end - cur[0].start > maxLen)) flush();
    cur.push({ ...w, i });
    if (/[.!?…]["')\]]?$/.test(w.text)) flush();
  });
  flush();
  return out.map((s, i) => ({ ...s, i }));
}

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Windows of about `span` seconds that overlap a little, so a moment on a border isn't lost.
function windows(sents, { span = 420, overlap = 45 } = {}) {
  const out = [];
  let a = 0;
  while (a < sents.length) {
    let b = a;
    while (b + 1 < sents.length && sents[b + 1].end - sents[a].start < span) b++;
    out.push([a, b]);
    if (b >= sents.length - 1) break;
    let next = b;
    while (next > a + 1 && sents[b].end - sents[next].start < overlap) next--;
    a = Math.max(a + 1, next + 1);
  }
  return out;
}

// ---------- The prompt ----------
const SYSTEM = `You are a sharp video editor who cuts long videos into short vertical clips for TikTok, Reels and YouTube Shorts.
You get part of a transcript as numbered lines with timestamps. Pick the moments most likely to make people stop scrolling and watch to the end.

A great clip:
- starts on a line that grabs attention on its own: a bold claim, a question, a surprise, a joke set-up, a strong emotion. Never start mid-thought or on "and", "so", "but", "yeah".
- makes sense to someone who has not seen the rest of the video.
- has a payoff: a punchline, an answer, a twist or a clear point, and ends right after it.
- lasts 20 to 60 seconds.

Skip intros, greetings, sponsor reads, "subscribe" requests, small talk and anything that needs earlier context.
Only pick moments that are genuinely good. Fewer great clips beat many average ones.
title: a few words that tease the moment, in the transcript's language. No hashtags, emoji or quotes.
score: 1 to 10, how well it would do as a short. Be strict: 9-10 only for standout moments.`;

const SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer' }, to: { type: 'integer' },
          title: { type: 'string', maxLength: 80 },
          score: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['from', 'to', 'title', 'score'],
      },
    },
  },
  required: ['clips'],
};

function windowPrompt(sents, [a, b], want) {
  const lines = [];
  for (let i = a; i <= b; i++) lines.push(`[${i}] (${mmss(sents[i].start)}) ${sents[i].text}`);
  return `Transcript lines ${a} to ${b}:\n\n${lines.join('\n')}\n\nPick up to ${want} clips. "from" is the first line number and "to" the last line number of each clip.`;
}

// ---------- Cleaning up the model's picks ----------
function shape(sents, pick) {
  let a = Math.max(0, Math.min(pick.from, pick.to));
  let b = Math.min(sents.length - 1, Math.max(pick.from, pick.to));
  if (!sents[a] || !sents[b]) return null;
  const len = () => sents[b].end - sents[a].start;
  // Too long: drop lines from the end (the opening is the hook, keep it).
  while (len() > MAX_LEN && b > a) b--;
  if (len() > MAX_LEN + 15) return null; // one giant line: not a clip
  // Too short: add following lines, then earlier ones, while it stays sensible.
  while (len() < MIN_LEN && b + 1 < sents.length && sents[b + 1].end - sents[a].start <= IDEAL[1]) b++;
  while (len() < MIN_LEN && a > 0 && sents[b].end - sents[a - 1].start <= IDEAL[1]) a--;
  if (len() < MIN_LEN - 3) return null;
  return {
    from: a, to: b,
    start: Math.max(0, sents[a].start - 0.15),
    end: sents[b].end + 0.35,
    title: cleanTitle(pick.title, sents[a].text),
    score: Math.max(1, Math.min(10, Math.round(pick.score || 5))),
  };
}

function cleanTitle(t, fallback) {
  let s = String(t || '').replace(/[#"“”]|\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
  // Small models sometimes echo the instructions instead of writing a title.
  if (/tease the moment|catchy hook|at most \d+ words|transcript'?s language|^title\b/i.test(s)) s = '';
  if (!s) s = fallback.split(' ').slice(0, 7).join(' ');
  if (s.length > 70) s = s.slice(0, 67).replace(/\s+\S*$/, '') + '…';
  return s.replace(/[.,;:]$/, '');
}

// Overlapping picks (from neighbouring windows, or the model repeating itself): keep the best.
function dedupe(clips) {
  const sorted = [...clips].sort((x, y) => y.score - x.score || (x.end - x.start) - (y.end - y.start));
  const kept = [];
  for (const c of sorted) {
    const clash = kept.some((k) => {
      const ov = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return ov > 0.35 * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!clash) kept.push(c);
  }
  return kept;
}

// How many clips to aim for: roughly one per two minutes, between 3 and 15.
const target = (duration) => Math.max(3, Math.min(15, Math.round(duration / 120)));

// Without a model (or if it fails): speech-dense stretches that start on a sentence, evenly spread.
function fallback(sents, duration) {
  const want = target(duration);
  const out = [];
  for (let a = 0; a < sents.length; a++) {
    let b = a;
    while (b + 1 < sents.length && sents[b + 1].end - sents[a].start <= 45) b++;
    const len = sents[b].end - sents[a].start;
    if (len < MIN_LEN) continue;
    const words = sents.slice(a, b + 1).reduce((n, s) => n + s.text.split(' ').length, 0);
    const opener = /\?$|!$/.test(sents[a].text) ? 1.5 : /^(and|so|but|yeah|um|uh)\b/i.test(sents[a].text) ? -2 : 0;
    out.push({ from: a, to: b, start: sents[a].start - 0.15, end: sents[b].end + 0.35, title: cleanTitle('', sents[a].text), score: Math.min(10, Math.round(3 + words / len + opener)), _d: words / len + opener });
  }
  return dedupe(out.sort((x, y) => y._d - x._d)).slice(0, want).map(({ _d, ...c }) => c);
}

// ask({ system, user, schema }) → parsed JSON. onProgress(0..100).
async function find(words, { duration, ask, onProgress = () => {}, signal, span, overlap } = {}) {
  const sents = sentences(words);
  if (!sents.length) return { clips: [], sentences: sents, method: 'none' };
  const dur = duration || sents[sents.length - 1].end;
  if (!ask) return { clips: fallback(sents, dur), sentences: sents, method: 'fallback' };
  const wins = windows(sents, { span, overlap });
  const want = Math.max(2, Math.min(6, Math.ceil(target(dur) * 1.6 / wins.length)));
  const picks = [];
  for (let k = 0; k < wins.length; k++) {
    if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const [a, b] = wins[k];
    try {
      const r = await ask({ system: SYSTEM, user: windowPrompt(sents, wins[k], want), schema: SCHEMA, signal });
      for (const p of (r && r.clips) || []) {
        if (p.from < a - 2 || p.to > b + 2) continue; // made-up line numbers
        const c = shape(sents, p);
        if (c) picks.push(c);
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }
    onProgress(Math.round(((k + 1) / wins.length) * 100));
  }
  if (!picks.length) return { clips: fallback(sents, dur), sentences: sents, method: 'fallback' };
  const clips = dedupe(picks).slice(0, target(dur) + 3);
  return { clips, sentences: sents, method: 'model' };
}

return { sentences, windows, shape, dedupe, fallback, find, target, SYSTEM, SCHEMA, windowPrompt, MIN_LEN, MAX_LEN };
}));
