// The moment finder: runs llama.cpp's server on this computer, on a free local port, and asks a
// small local model which parts of a transcript make good clips. The server only listens on 127.0.0.1.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

let proc = null;
let port = 0;
let modelFile = null;
let starting = null;
let lastError = '';

function serverDir(app) {
  const plat = process.platform === 'win32' ? 'win32-x64' : `darwin-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'llama')
    : path.join(__dirname, '..', '..', 'vendor', 'llama', plat);
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function waitHealthy(p, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!proc) throw new Error(lastError || 'The moment finder stopped while starting.');
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The moment finder took too long to start.');
}

// Start (or restart with another model). Resolves once the model is loaded.
async function start(app, file) {
  if (proc && modelFile === file) return starting || Promise.resolve();
  stop();
  modelFile = file;
  starting = (async () => {
    const dir = serverDir(app);
    const exe = path.join(dir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    if (!fs.existsSync(exe)) throw new Error('The moment finder is missing. Please reinstall Clipshaper.');
    port = await freePort();
    const args = [
      '-m', file, '--host', '127.0.0.1', '--port', String(port),
      '-c', '12288', '--parallel', '1', '-ngl', '99',
      '--reasoning-budget', '0', '--no-webui', '--log-disable',
    ];
    lastError = '';
    proc = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (d) => { lastError = (lastError + d.toString()).slice(-2000); });
    const me = proc;
    proc.on('exit', () => { if (proc === me) { proc = null; starting = null; } });
    await waitHealthy(port, 120000);
  })();
  try { await starting; } catch (e) { stop(); throw e; }
  return starting;
}

function stop() {
  if (proc) { try { proc.kill(); } catch { /* gone */ } }
  proc = null; starting = null; modelFile = null;
}

const running = () => !!proc;

// One JSON answer, shaped by a JSON schema (llama.cpp turns it into a grammar, so the
// small model can't wander off format).
async function ask({ system, user, schema, temperature = 0.3, maxTokens = 1500, signal }) {
  if (starting) await starting;
  if (!proc) throw new Error('The moment finder is not running.');
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature, top_p: 0.9, max_tokens: maxTokens, stream: false,
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } } } : {}),
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`The moment finder said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (process.env.CLIPSHAPER_TIMINGS) console.error('llm timings', JSON.stringify(j.timings));
  const text = j.choices?.[0]?.message?.content || '';
  return schema ? JSON.parse(text) : text;
}

module.exports = { start, stop, running, ask, serverDir };
