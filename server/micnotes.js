// Reads mic / IEM assignments out of free-text Planning Center notes.
//
// Handles the ways people usually write them, one assignment per line or
// separated by commas or semicolons:
//   VOX 1 - Caleb            Caleb: VOX 3          Clyde Stackhouse – Vox2
//   HH-1 Jordan              Todd BP-1             TEACH: PT
//   Caleb VOX 1 / IEM 4   (mic and IEM together)
// A piece counts only when it holds exactly one mic and names exactly one
// scheduled person (full name, first name if it's unique, or a known
// nickname). Anything unclear is skipped; FOH can always set it by hand.

const MIC_RE = /\b(?:(VOX|VOC|V)\s*-?\s*#?\s*(\d{1,2})|(HH)\s*-?\s*#?\s*(\d{1,2})|(BP)\s*-?\s*#?\s*(\d{1,2})|(TEACH(?:ING)?))\b/gi;
const IEM_RE = /\b(IEM|EAR|EARS)\s*-?\s*#?\s*(\d{1,2})\b/gi;

function micName(m) {
  if (m[1]) return `VOX ${Number(m[2])}`;
  if (m[3]) return `HH-${Number(m[4])}`;
  if (m[5]) return `BP-${Number(m[6])}`;
  return 'TEACH';
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '');

// people: [{ name, aliases: [...] }]  →  { 'Full Name': { mic, iem } }
function parseMicNotes(text, people) {
  const out = {};
  if (!text || !people.length) return out;

  // Name variants → person. First names only when no one else shares them.
  const firstCount = {};
  for (const p of people) {
    const f = fold(p.name).split(/\s+/)[0];
    firstCount[f] = (firstCount[f] || 0) + 1;
  }
  const variants = [];
  for (const p of people) {
    const full = fold(p.name);
    const parts = full.split(/\s+/);
    const add = (v) => v && v.length >= 2 && variants.push({ v, p: p.name });
    add(full);
    add(full.replace(/\s+(jr|sr|ii|iii|iv)\.?$/, ''));
    if (firstCount[parts[0]] === 1) add(parts[0]);
    if (parts.length > 1 && firstCount[parts[0]] === 1) add(`${parts[0]} ${parts[parts.length - 1][0]}`);
    for (const a of p.aliases || []) add(fold(a));
  }
  variants.sort((a, b) => b.v.length - a.v.length); // longest match first

  const pieces = String(text)
    .split(/\n|;|,|\|/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const piece of pieces) {
    const mics = [...piece.matchAll(MIC_RE)];
    const iems = [...piece.matchAll(IEM_RE)];
    if (mics.length > 1 || iems.length > 1 || (!mics.length && !iems.length)) continue;
    // Find names, blanking each match so "Caleb" inside "Caleb Grenz" isn't counted twice.
    let hay = ' ' + fold(piece).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const found = new Set();
    for (const { v, p } of variants) {
      const needle = ' ' + v.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      if (hay.includes(needle)) {
        found.add(p);
        hay = hay.split(needle).join(' ');
      }
    }
    if (found.size !== 1) continue;
    const name = [...found][0];
    out[name] = out[name] || {};
    if (mics.length) out[name].mic = micName(mics[0]);
    if (iems.length) out[name].iem = `IEM ${Number(iems[0][2])}`;
  }
  return out;
}

module.exports = { parseMicNotes };
