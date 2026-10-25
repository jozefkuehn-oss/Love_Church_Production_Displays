// Slack profile photos. Needs a Slack app with the users:read scope installed
// in the workspace (its "Bot User OAuth Token", starting xoxb-). Photos are
// downloaded once and kept in data/photos, so the screens never depend on
// Slack being reachable during an Encounter.
const fs = require('fs');
const path = require('path');
const { PHOTO_DIR } = require('../store');

async function listUsers(token) {
  const users = [];
  let cursor = '';
  for (let guard = 0; guard < 50; guard++) {
    const url = `https://slack.com/api/users.list?limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!body.ok) throw new Error(`Slack: ${body.error || res.status}`);
    users.push(...body.members.filter((m) => !m.deleted && !m.is_bot));
    cursor = body.response_metadata && body.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return users;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

// Returns { 'Planning Center Name': '/photos/slack-U123.jpg' } for everyone it
// can match. nameMap holds the people whose Slack name differs.
async function syncPhotos(token, names, nameMap) {
  const users = await listUsers(token);
  const byName = new Map();
  for (const u of users) {
    const p = u.profile || {};
    for (const n of [p.real_name, p.display_name, u.real_name, u.name]) {
      if (n && !byName.has(norm(n))) byName.set(norm(n), u);
    }
  }
  const out = {};
  for (const name of names) {
    const u = byName.get(norm(nameMap[name] || name)) || byName.get(norm(name));
    if (!u || !u.profile || !u.profile.is_custom_image) continue; // skip default avatars
    const src = u.profile.image_original || u.profile.image_1024 || u.profile.image_512;
    if (!src) continue;
    const file = `slack-${u.id}.jpg`;
    const dest = path.join(PHOTO_DIR, file);
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      out[name] = `/photos/${file}`;
    } catch (e) {
      // keep any copy downloaded on an earlier sync
      if (fs.existsSync(dest)) out[name] = `/photos/${file}`;
    }
  }
  return out;
}

module.exports = { syncPhotos };
