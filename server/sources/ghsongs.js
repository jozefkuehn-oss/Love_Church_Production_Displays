// Song bank updates from GitHub. The song repository (Broadcast Notes) is
// turned into server/seed/songbank.json by scripts/songbank_from_md.py and
// pushed; the Mac checks it hourly and:
//   * adds songs it doesn't have,
//   * updates songs that changed in the repository,
//   * leaves alone any song someone edited in Admin → Songs.
// db.songbankApplied remembers which version of each song it last applied.
const crypto = require('crypto');

const RAW = 'https://raw.githubusercontent.com/jozefkuehn-oss/Love_Church_Production_Displays/main/server/seed/songbank.json';
const FIELDS = ['title', 'feel', 'progression', 'notes'];
const hash = (s) => crypto.createHash('sha1').update(JSON.stringify(FIELDS.map((f) => String((s && s[f]) || '')))).digest('hex').slice(0, 12);

async function sync(db) {
  const res = await fetch(RAW, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  const bank = await res.json();
  const songs = (db.data.songs = db.data.songs || {});
  const applied = (db.data.songbankApplied = db.data.songbankApplied || {});
  const out = { added: [], updated: [], kept: [] };
  for (const [k, s] of Object.entries(bank)) {
    const h = hash(s);
    const local = songs[k];
    if (!local) {
      songs[k] = { title: s.title || '', lead: s.lead || '', feel: s.feel || '', progression: s.progression || '', notes: s.notes || '', cue: '' };
      applied[k] = h;
      out.added.push(s.title);
      continue;
    }
    if (applied[k] === h) continue;
    const lh = hash(local);
    if (lh === h) {
      applied[k] = h; // already the same
    } else if (applied[k] && lh === applied[k]) {
      // Unchanged here since we last applied it: take the new version (keep lead/cue).
      for (const f of FIELDS) local[f] = s[f] || '';
      applied[k] = h;
      out.updated.push(s.title);
    } else {
      out.kept.push(local.title || s.title); // edited in Admin → Songs: leave it
    }
  }
  if (out.added.length || out.updated.length) db.save();
  return out;
}

module.exports = { sync, hash };
