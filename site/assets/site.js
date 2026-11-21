// Clipshaper website: menu, OS-aware download buttons, scroll reveals, and the hero demo.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Menu on small screens
  const menu = $('.menu-btn'); const links = $('#links');
  menu?.addEventListener('click', () => { const o = links.classList.toggle('open'); menu.setAttribute('aria-expanded', o); });
  links?.addEventListener('click', (e) => { if (e.target.closest('a')) links.classList.remove('open'); });

  // Put the visitor's own system first
  const ua = navigator.userAgent;
  const os = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'mac' : /Win/i.test(ua) ? 'win' : null;
  if (os) {
    for (const cta of $$('.cta')) {
      const mine = $(`[data-os="${os}"]`, cta); const other = $(`[data-os="${os === 'mac' ? 'win' : 'mac'}"]`, cta);
      if (mine && other) { other.hidden = true; }
    }
    $(`[data-os-card="${os}"]`)?.classList.add('mine');
  }

  // Reveal on scroll
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));

  // The big statement lights up word by word as it scrolls past.
  const words = $$('.big-statement span');
  if (words.length) {
    let queued = false;
    const lit = () => {
      queued = false;
      const r = $('.big-statement').getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      const n = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle('lit', i < n));
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(lit); } }, { passive: true }); lit();
  }

  // ---------- Hero demo ----------
  // The transcript is read top to bottom, three lines are picked, the timeline marks them,
  // then three phones appear with their clip: the crop slides to the speaker, captions karaoke.
  const show = $('.show');
  if (!show) return;
  const src = $('.src', show); const lines = $$('.line', show); const scan = $('.scan', show);
  const segs = $$('.tl .seg', show); const phones = $$('.ph', show);
  const picks = JSON.parse(show.dataset.picks); // line index per phone
  let visible = false; let loopId = 0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !show.dataset.running) run(); }, { threshold: 0.2 }).observe(show);

  function reset() {
    lines.forEach((l) => l.classList.remove('read', 'pick'));
    segs.forEach((s) => s.classList.remove('on'));
    phones.forEach((p) => { p.classList.remove('on', 'follow'); $('.scene', p).style.transition = 'none'; $('.scene', p).style.transform = `translateX(${p.dataset.shift}%)`; void p.offsetWidth; $('.scene', p).style.transition = ''; $$('.cap span', p).forEach((s) => s.classList.remove('hl')); });
  }
  async function karaoke(p, id) {
    const ws = $$('.cap span', p);
    for (let k = 0; visible && id === loopId && k < 40; k++) {
      ws.forEach((w, i) => w.classList.toggle('hl', i === k % ws.length));
      await wait(430);
    }
  }
  async function run() {
    show.dataset.running = '1';
    const id = ++loopId;
    if (reduce) {
      lines.forEach((l, i) => l.classList.toggle('pick', picks.includes(i)));
      segs.forEach((s) => s.classList.add('on')); phones.forEach((p) => p.classList.add('on'));
      return;
    }
    while (visible && id === loopId) {
      reset();
      src.classList.add('running');
      for (let i = 0; i < lines.length; i++) {
        scan.style.transform = `translateY(${lines[i].offsetTop}px)`;
        lines[i].classList.add('read');
        await wait(260);
        const k = picks.indexOf(i);
        if (k >= 0) { lines[i].classList.add('pick'); segs[k].classList.add('on'); await wait(220); }
      }
      src.classList.remove('running');
      await wait(250);
      for (let k = 0; k < phones.length; k++) {
        const p = phones[k];
        p.classList.add('on');
        await wait(260);
        p.classList.add('follow');
        $('.scene', p).style.transform = 'none';
      }
      await Promise.all(phones.map((p) => karaoke(p, id)));
      if (!visible) break;
      await wait(400);
    }
    delete show.dataset.running;
  }
})();
