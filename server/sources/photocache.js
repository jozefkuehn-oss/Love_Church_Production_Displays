// Keeps local copies of people's Slack / Planning Center photos in data/photos,
// so screens never load pictures from the internet during an Encounter.
// A photo is only downloaded again when the person changes it (its address
// changes); the record of what was downloaded lives in data/photos/<kind>-index.json.
const fs = require('fs');
const path = require('path');
const { PHOTO_DIR } = require('../store');
const { slugify } = require('../photos');

function readIndex(kind) {
  try {
    return JSON.parse(fs.readFileSync(path.join(PHOTO_DIR, kind + '-index.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}
function writeIndex(kind, idx) {
  try {
    fs.writeFileSync(path.join(PHOTO_DIR, kind + '-index.json'), JSON.stringify(idx));
  } catch (e) {}
}

// items: [{ name, id, url }] -> { name: '/photos/<file>' } (and how many changed)
async function cache(kind, items) {
  const idx = readIndex(kind);
  const out = {};
  let changed = 0;
  for (const it of items) {
    const file = `${kind}-${String(it.id || slugify(it.name)).replace(/[^A-Za-z0-9-]/g, '')}.jpg`;
    const dest = path.join(PHOTO_DIR, file);
    // Same address as last time and the file's here: nothing to do.
    if (idx[file] === it.url && fs.existsSync(dest)) {
      out[it.name] = `/photos/${file}?v=${encodeURIComponent(String(fs.statSync(dest).mtimeMs | 0))}`;
      continue;
    }
    try {
      const res = await fetch(it.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) throw new Error('too small');
      fs.writeFileSync(dest, buf);
      idx[file] = it.url;
      changed++;
    } catch (e) {
      if (!fs.existsSync(dest)) continue; // keep an earlier copy if there is one
    }
    // ?v= changes with the file, so screens show a new photo right away.
    out[it.name] = `/photos/${file}?v=${encodeURIComponent(String(fs.statSync(dest).mtimeMs | 0))}`;
  }
  writeIndex(kind, idx);
  return { photos: out, changed };
}

module.exports = { cache };
