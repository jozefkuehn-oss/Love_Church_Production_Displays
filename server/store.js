// Small JSON-file persistence. Everything the app remembers lives in ./data
// (config.json for settings and credentials, db.json for everything else).
// Writes are atomic (write to a temp file, then rename) so a power cut can't
// leave a half-written file behind.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.LCD_DATA_DIR || path.join(__dirname, '..', 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

class Doc {
  constructor(name, defaults) {
    this.file = path.join(DATA_DIR, name);
    const loaded = readJson(this.file, null);
    this.data = deepMerge(structuredClone(defaults), loaded || {});
    this._timer = null;
    if (!loaded) this.saveNow();
  }
  save() {
    // Coalesce bursts of changes into one write.
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 150);
  }
  saveNow() {
    clearTimeout(this._timer);
    writeJsonAtomic(this.file, this.data);
  }
}

// Fill in keys that are missing from saved data (so new settings appear after
// an update) without overwriting anything the user changed. Arrays are kept as
// saved.
function deepMerge(base, saved) {
  if (Array.isArray(base) || Array.isArray(saved)) return saved !== undefined ? saved : base;
  if (base && typeof base === 'object' && saved && typeof saved === 'object') {
    const out = { ...base };
    for (const k of Object.keys(saved)) out[k] = k in base ? deepMerge(base[k], saved[k]) : saved[k];
    return out;
  }
  return saved !== undefined ? saved : base;
}

module.exports = { Doc, DATA_DIR, PHOTO_DIR };
