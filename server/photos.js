// Name → starter-photo file lookup, shared by the engine and the admin API.
// Starter photos live in server/seed/photos/<slug>.jpg, where the slug is the
// name lowercased with accents and apostrophes dropped and every other run of
// non-letters turned into a hyphen ("Adé Idowu" → ade-idowu,
// "Mike O'Connell" → mike-oconnell, "Clyde Stackhouse Jr." → clyde-stackhouse-jr).
const fs = require('fs');
const path = require('path');

const SEED_PHOTO_DIR = path.join(__dirname, 'seed', 'photos');

function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Older builds used a slightly different rule; check it too so nothing breaks.
function legacySlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '-');
}

function seedPhoto(name) {
  for (const s of [slugify(name), legacySlug(name)]) {
    if (s && fs.existsSync(path.join(SEED_PHOTO_DIR, s + '.jpg'))) return '/seed-photos/' + s + '.jpg';
  }
  return '';
}

let rosterCache = null;
// Everyone the app knows about even when they're not on today's plan: the
// serving roster that ships with the app (server/seed/roster.json).
function roster() {
  if (!rosterCache) {
    try {
      rosterCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'roster.json'), 'utf8'));
    } catch (e) {
      rosterCache = [];
    }
  }
  return rosterCache;
}

module.exports = { slugify, seedPhoto, roster, SEED_PHOTO_DIR };
