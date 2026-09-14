const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

class OmrService {
  constructor({ root, python = process.env.OMR_PYTHON || 'python3',
    bundle = process.env.OMR_BUNDLE || path.join(root, 'ml/data/releases/baseline-14drum-v1'),
    startupTimeout = 30000 } = {}) {
    Object.assign(this, { root, python, bundle, startupTimeout });
    this.generation = 0;
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = this.launch().catch(async error => {
      await this.stop();
      throw error;
    });
    return this.starting;
  }

  async launch() {
    const generation = this.generation;
    for (const name of ['omr.onnx', 'omr_config.json']) {
      try { await fs.access(path.join(this.bundle, name)); }
      catch { throw new Error(`Missing ${name} in ${this.bundle}. Restore the released bundle or set OMR_BUNDLE before starting the app.`); }
    }
    if (generation !== this.generation) throw new Error('Recognition startup was canceled. Retry the import.');
    const child = spawn(this.python, ['-u', path.join(this.root, 'backend/app.py'),
      '--bundle', this.bundle, '--port', '0'], { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.failure = null;
    let output = '', diagnostic = '';
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4000); });
    child.on('error', error => { this.failure = new Error(`Cannot start Python (${this.python}): ${error.message}. Install backend/requirements.txt and set OMR_PYTHON to your Python executable.`); });
    child.on('exit', () => {
      this.failure = new Error(`The recognition service stopped. Install backend/requirements.txt and check the model bundle, then retry. ${diagnostic.trim()}`);
      if (this.child === child) { this.child = null; this.starting = null; }
    });
    child.stdout.on('data', chunk => {
      output += chunk;
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        try {
          const ready = JSON.parse(line);
          if (Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535) {
            this.url = `http://127.0.0.1:${ready.port}`;
            this.modelHash = ready.model_sha256;
          }
        } catch { /* Python may print diagnostics before the readiness record. */ }
      }
    });
    this.url = null;
    const deadline = Date.now() + this.startupTimeout;
    while (Date.now() < deadline) {
      if (this.failure) throw this.failure;
      if (this.url) {
        try {
          const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1000) });
          const health = await response.json();
          if (response.ok && health.status === 'ok' && health.model_sha256 === this.modelHash) return health;
        } catch { /* The socket is bound before Uvicorn finishes startup. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Recognition service startup timed out. Check your Python installation and model bundle, then retry.');
  }

  async predict(filePath) {
    const health = await this.start();
    const file = await fs.open(filePath, 'r');
    let data;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Choose a PNG or JPEG file.');
      if (stat.size > health.max_upload_bytes) throw new Error('Choose a PNG or JPEG image of 10 MB or smaller.');
      data = Buffer.alloc(Math.min(stat.size + 1, health.max_upload_bytes + 1));
      let total = 0;
      while (total < data.length) {
        const { bytesRead } = await file.read(data, total, data.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      data = data.subarray(0, total);
      if (data.length > health.max_upload_bytes) throw new Error('Choose a PNG or JPEG image of 10 MB or smaller.');
    } finally { await file.close(); }
    const form = new FormData();
    form.append('image', new Blob([data]), path.basename(filePath));
    let response;
    try {
      response = await fetch(`${this.url}/predict`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    } catch {
      await this.stop();
      throw new Error('Recognition did not respond. Retry the import to restart the local service.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.error?.message || 'Recognition failed'}. Choose a clear PNG or JPEG crop of one bar and retry.`);
    if (!Array.isArray(result.notes) || result.model_sha256 !== this.modelHash) {
      throw new Error('The model returned invalid output. Check the released bundle and retry.');
    }
    return { ...result, gridSlots: health.grid_slots };
  }

  async stop() {
    this.generation++;
    const child = this.child;
    this.child = null; this.starting = null; this.url = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

module.exports = { OmrService };
