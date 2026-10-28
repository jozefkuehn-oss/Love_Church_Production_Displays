// Slack photos refreshed weekly by a scheduled Claude task (scripts/slack_photos.py)
// land in the GitHub repo. This checks the repo's photo list every hour and
// downloads any photo that's newer than the copy the app shipped with, so new
// faces reach the screens without updating the app.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PHOTO_DIR } = require('../store');
const { slugify, SEED_PHOTO_DIR } = require('../photos');

const RAW = 'https://raw.githubusercontent.com/jozefkuehn-oss/Love_Church_Production_Displays/main/';
const shipped = new Map(); // slug -> hash of the photo bundled with this app version
function shippedV(slug) {
  if (!shipped.has(slug)) {
    let v = '';
    try {
      v = crypto.createHash('sha1').update(fs.readFileSync(path.join(SEED_PHOTO_DIR, slug + '.jpg'))).digest('hex').slice(0, 12);
    } catch (e) {}
    shipped.set(slug, v);
  }
  return shipped.get(slug);
}

// -> { photos: { name: '/photos/gh-<slug>.jpg?v=…' }, changed }
async function sync() {
  const res = await fetch(RAW + 'server/seed/slack-photos.json', { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const manifest = await res.json();
  const out = {};
  let changed = 0;
  for (const [name, e] of Object.entries(manifest)) {
    if (!e || !e.v) continue;
    const slug = slugify(name);
    if (shippedV(slug) === e.v) continue; // the app already has this exact photo
    const file = `gh-${slug}.jpg`;
    const dest = path.join(PHOTO_DIR, file);
    const have = fs.existsSync(dest) ? crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex').slice(0, 12) : '';
    if (have !== e.v) {
      try {
        const r = await fetch(RAW + `server/seed/photos/${slug}.jpg`, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        changed++;
      } catch (err) {
        if (!have) continue;
      }
    }
    out[name] = `/photos/${file}?v=${e.v}`;
  }
  return { photos: out, changed };
}

module.exports = { sync };
