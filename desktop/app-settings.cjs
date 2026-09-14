// App-wide settings stored as JSON in the app's data folder (not in score files).
// cloudAssist.enabled: an adult has turned on cloud help (Ask DrumHub with OpenAI and
// screenshot import). Off by default: DrumHub is for young drummers, and the plan keeps
// cloud features in an adult-confirmed mode (plan §2.1).
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULTS = Object.freeze({ cloudAssist: Object.freeze({ enabled: false, changedAt: null }) });

class AppSettings {
  // writeAtomic(filePath, text): ScoreFiles#writeAtomic, so settings are never half-written.
  constructor({ dataDir, writeAtomic, now = () => new Date().toISOString() }) {
    Object.assign(this, { writeAtomic, now });
    this.file = path.join(dataDir, 'settings.json');
    this.values = DEFAULTS;
  }

  // Unreadable or unexpected settings fall back to the safe defaults (cloud help off).
  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const enabled = raw?.cloudAssist?.enabled === true;
      const changedAt = typeof raw?.cloudAssist?.changedAt === 'string' ? raw.cloudAssist.changedAt : null;
      this.values = Object.freeze({ cloudAssist: Object.freeze({ enabled, changedAt }) });
    } catch {
      this.values = DEFAULTS;
    }
    return this.values;
  }

  get cloudEnabled() { return this.values.cloudAssist.enabled; }

  async setCloud(enabled) {
    const next = Object.freeze({ cloudAssist: Object.freeze({ enabled: Boolean(enabled), changedAt: this.now() }) });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await this.writeAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    this.values = next;
    return next;
  }
}

module.exports = { AppSettings };
