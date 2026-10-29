// Love Church Production Displays — server.
// Serves every display (/display/<profile>), the admin and leader messages page
// (/admin), and pushes a live snapshot to every screen once a second.
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Doc, PHOTO_DIR, DATA_DIR } = require('./store');
const { configDefaults, dbDefaults, LOCATIONS, LAYOUT_REVISIONS, preshowFrom } = require('./defaults');
const { makeAuth } = require('./auth');
const { makeClock, parts, zoned } = require('./time');
const { makeEngine } = require('./engine');
const photos = require('./photos');
const { makeStreams } = require('./stream');
const { makeTvs } = require('./tvs');

const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'server.log'), line + '\n');
  } catch (e) {}
}

const config = new Doc('config.json', configDefaults);
// Messages now clear after 1 minute by default (was 2). Only changes installs
// still on the old default.
if (!config.data.msgDefault60) {
  if (config.data.messageDefaultSeconds === 120) config.data.messageDefaultSeconds = 60;
  config.data.msgDefault60 = true;
  config.save();
}
const db = new Doc('db.json', dbDefaults);
// Song bank from the Broadcast Notes song repository (progression + feel).
// Added once; songs already in the bank (or edited in Admin → Songs) are kept.
if ((db.data.songbankVersion || 0) < 1) {
  const bank = require('./seed/songbank.json');
  db.data.songs = db.data.songs || {};
  let added = 0;
  for (const [k, v] of Object.entries(bank)) {
    if (db.data.songs[k]) continue;
    db.data.songs[k] = { ...v, cue: '' };
    added++;
  }
  db.data.songbankVersion = 1;
  db.save();
  console.log(`Song bank: added ${added} songs from the Broadcast Notes repository.`);
}
const clock = makeClock(config);
const engine = makeEngine({ config, db, clock, log });
const auth = makeAuth(db, {
  // Role sign-ins last until midnight, church time.
  endOfDay: () => {
    const tz = config.data.timezone;
    return zoned(parts(Date.now(), tz).dateKey, '23:59', tz) + 60000;
  },
  // Who is scheduled in this role on the current plan (only if exactly one).
  scheduledFor: (roleName) => {
    const role = (db.data.roles || []).find((r) => r.name === roleName);
    const positions = new Set([roleName, ...((role && role.positions) || [])].map((x) => x.toLowerCase()));
    const plan = engine.getPlan();
    const names = [...new Set(((plan && plan.people) || []).filter((p) => positions.has(String(p.position || '').toLowerCase())).map((p) => p.name))];
    return names.length === 1 ? names[0] : '';
  },
});

// Bring profiles saved by older versions up to date: every room has a
// Pre-Encounter and a Live layout, and one mode setting (auto / pre / live).
// Roles saved by an earlier build: drop the unused Encounter Lead role, add
// the director roles and the Floor Manager's handheld permission.
(function migrateRoles() {
  if ((db.data.rolesVersion || 1) >= 2) return;
  const roles = db.data.roles || [];
  db.data.roles = roles.filter((r) => r.id !== 'encounter-lead');
  for (const def of dbDefaults.roles) {
    const have = db.data.roles.find((r) => r.id === def.id);
    if (!have) db.data.roles.push(structuredClone(def));
    else if (def.id === 'floor-manager' || def.id === 'foh') have.perms = [...new Set([...(have.perms || []), 'handhelds'])];
  }
  db.data.rolesVersion = 2;
  db.save();
})();
// Builds before the overall-administrator flag: the first admin account is it.
(function migrateOwner() {
  if (db.data.accounts.some((a) => a.owner)) return;
  const first = db.data.accounts.find((a) => a.role === 'admin');
  if (first) {
    first.owner = true;
    db.save();
  }
})();

(function migrateRoles3() {
  if ((db.data.rolesVersion || 1) >= 3) return;
  const td = (db.data.roles || []).find((r) => r.id === 'technical-director');
  if (td) td.perms = [...new Set([...(td.perms || []), 'admin', 'roles'])];
  // Technical Director first in the list.
  db.data.roles.sort((a, b) => (b.id === 'technical-director') - (a.id === 'technical-director'));
  db.data.rolesVersion = 3;
  db.save();
})();

// FOH Audio: messages + all mics/IEMs (no Live control). Producers get
// everything FOH has plus Live. Only changes roles still on the old defaults.
(function migrateRoles4() {
  if ((db.data.rolesVersion || 1) >= 4) return;
  const same = (a, b) => [...(a || [])].sort().join() === [...b].sort().join();
  for (const r of db.data.roles || []) {
    if (r.id === 'foh') {
      if (same(r.perms, ['messages', 'live', 'wireless', 'handhelds'])) r.perms = ['messages', 'wireless', 'handhelds'];
      if (r.name === 'FOH Engineer') r.name = 'FOH Audio';
    }
    if ((r.id === 'service-producer' || r.id === 'broadcast-producer') && same(r.perms, ['messages', 'live'])) r.perms = ['messages', 'live', 'wireless', 'handhelds'];
  }
  db.data.rolesVersion = 4;
  db.save();
})();

// Finer permissions: Subs (producers), Recording the 11:45 (Broadcast
// Producer only) and Rehearsal (admins only, nothing to add).
(function migrateRoles5() {
  if ((db.data.rolesVersion || 1) >= 5) return;
  for (const r of db.data.roles || []) {
    const p = new Set(r.perms || []);
    if (p.has('live') && !p.has('admin')) p.add('subs');
    if (r.id === 'broadcast-producer') p.add('recording');
    r.perms = [...p];
  }
  db.data.rolesVersion = 5;
  db.save();
})();

// Displays saved by an earlier build: give every dashboard a location and
// add the second Greenroom TV and the extra FOH monitors.
(function migrateLocations() {
  if ((db.data.profilesVersion || 1) >= 2) return;
  for (const [id, def] of Object.entries(dbDefaults.profiles)) {
    const cur = db.data.profiles[id];
    if (!cur) db.data.profiles[id] = structuredClone(def);
    else if (!cur.location) cur.location = def.location;
  }
  for (const p of Object.values(db.data.profiles)) if (!p.location) p.location = 'Other';
  db.data.profilesVersion = 2;
  db.save();
})();

// FOH Timers dashboard: add the live ProPresenter timers if it's untouched.
(function migrateTimers() {
  if ((db.data.profilesVersion || 1) >= 3) return;
  const p = db.data.profiles['foh-timers'];
  const live = p && p.layouts && p.layouts.live && p.layouts.live.widgets;
  if (live && live.some((w) => w.id === 'ky' && w.x === 16 && w.y === 6) && !live.some((w) => w.type === 'propTimers')) {
    p.layouts.live.widgets = structuredClone(dbDefaults.profiles['foh-timers'].layouts.live.widgets);
  }
  db.data.profilesVersion = 3;
  db.save();
})();

// Broadcast Control: show ProPresenter slide pictures instead of the text-only
// graphics box (only if that box hasn't been moved).
(function migrateSlidePreview() {
  if ((db.data.profilesVersion || 1) >= 4) return;
  const live = db.data.profiles.broadcast && db.data.profiles.broadcast.layouts && db.data.profiles.broadcast.layouts.live;
  const g = live && live.widgets.find((w) => w.id === 'gr' && w.type === 'graphics' && w.x === 11 && w.y === 6);
  if (g) {
    g.type = 'slidePreview';
    g.opts = { source: 'broadcast' };
  }
  db.data.profilesVersion = 4;
  db.save();
})();

// Preshow: 4:30 ending 8:44:30 and 9:59:30, shown in the projected-finish
// tiles on Broadcast Control and FOH Timers.
(function migratePreshow() {
  if ((db.data.profilesVersion || 1) >= 5) return;
  const sch = db.data.schedule;
  const ends = { '08:30': '08:29:30', '10:00': '09:59:30' };
  for (const e of sch.encounters || []) if (!e.preshowEnd && ends[e.start]) e.preshowEnd = ends[e.start];
  if (sch.preshowSeconds == null) sch.preshowSeconds = 270;
  for (const [id, lay] of [['broadcast', 'live'], ['foh-timers', 'live'], ['foh', 'live']]) {
    const w = db.data.profiles[id] && db.data.profiles[id].layouts[lay].widgets.find((x) => x.type === 'projected');
    if (w) {
      w.opts = { fallback: 'projected', fallbackOpts: { ...(w.opts || {}) } };
      w.type = 'preshow';
    }
  }
  db.data.profilesVersion = 5;
  db.save();
})();

// 8:30 preshow ends 8:29:30 (was entered as 8:44:30).
(function migratePreshow830() {
  if ((db.data.profilesVersion || 1) >= 6) return;
  for (const e of db.data.schedule.encounters || []) if (e.start === '08:30' && e.preshowEnd === '08:44:30') e.preshowEnd = '08:29:30';
  db.data.profilesVersion = 6;
  db.save();
})();

// Preshow Confidence dashboard (for the online preshow hosts).
(function migratePreshowConfidence() {
  if ((db.data.profilesVersion || 1) >= 7) return;
  if (!db.data.profiles['preshow-confidence']) db.data.profiles['preshow-confidence'] = structuredClone(dbDefaults.profiles['preshow-confidence']);
  db.data.profilesVersion = 7;
  db.save();
})();

// Preshow Confidence: match the old ProPresenter preshow stage display.
(function migratePreshowConfidence2() {
  if ((db.data.profilesVersion || 1) >= 8) return;
  const p = db.data.profiles['preshow-confidence'];
  if (p && p.layouts.preshow && p.layouts.preshow.widgets.some((x) => x.type === 'slidePreview')) {
    p.layouts.pre = structuredClone(dbDefaults.profiles['preshow-confidence'].layouts.pre);
    p.layouts.preshow = structuredClone(dbDefaults.profiles['preshow-confidence'].layouts.preshow);
  }
  db.data.profilesVersion = 8;
  db.save();
})();

// New display names and locations: Broadcast, The Dock, The Greenroom, FOH, Stage.
(function migrateDisplayNames() {
  if ((db.data.profilesVersion || 1) >= 9) return;
  const set = { broadcast: ['Broadcast Control', 'Broadcast'], dock: ['The Dock', 'The Dock'], greenroom: ['The Greenroom', 'The Greenroom'],
    'greenroom-2': [null, 'The Greenroom'], foh: ['FOH ProP', 'FOH'], 'foh-wireless': ['FOH Audio', 'FOH'], 'foh-timers': ['Service Producer', 'FOH'],
    stage: ['Stage Display', 'Stage'], 'preshow-confidence': ['Pre-Show Teleprompter', 'Stage'] };
  const oldLoc = { 'Broadcast Control': 'Broadcast', Greenroom: 'The Greenroom', Preshow: 'Stage' };
  for (const [id, p] of Object.entries(db.data.profiles)) {
    if (set[id]) { if (set[id][0]) p.name = set[id][0]; p.location = set[id][1]; }
    else if (oldLoc[p.location]) p.location = oldLoc[p.location];
  }
  db.data.profilesVersion = 9;
  db.save();
})();

// Pre-Show gets its own location for the teleprompter.
(function migratePreShowLocation() {
  if ((db.data.profilesVersion || 1) >= 10) return;
  const p = db.data.profiles['preshow-confidence'];
  if (p) p.location = 'Pre-Show';
  db.data.profilesVersion = 10;
  db.save();
})();

// Renamed: Pre-/Post-Show.
(function migratePrePostShow() {
  if ((db.data.profilesVersion || 1) >= 11) return;
  for (const p of Object.values(db.data.profiles)) if (p.location === 'Pre-Show') p.location = 'Pre-/Post-Show';
  const t = db.data.profiles['preshow-confidence'];
  if (t) { t.location = 'Pre-/Post-Show'; if (/^Pre-Show Teleprompter$|^Preshow Confidence$/.test(t.name)) t.name = 'Pre-/Post-Show Teleprompter'; }
  db.data.profilesVersion = 11;
  db.save();
})();

// Spoken-word mics are no longer standard assignments (set weekly instead).
(function migrateSpokenMics() {
  if ((db.data.profilesVersion || 1) >= 12) return;
  const w = db.data.wireless || {};
  for (const k of Object.keys(w)) if (/^(Bible Teacher|Encounter Host|Online Host|Online Co-Host|TIP Host)(#\d+)?$/.test(k)) delete w[k];
  db.data.profilesVersion = 12;
  db.save();
})();

// The old second Greenroom dashboard is retired; any screen on it moves to
// The Greenroom.
const REPLACED_PROFILES = { 'greenroom-2': 'greenroom' };
(function retireGreenroomCountdown() {
  if ((db.data.profilesVersion || 1) >= 13 && !db.data.profiles['greenroom-2']) return;
  delete db.data.profiles['greenroom-2'];
  for (const d of Object.values(db.data.devices || {})) {
    if (REPLACED_PROFILES[d.profile]) d.profile = REPLACED_PROFILES[d.profile];
    if (REPLACED_PROFILES[d.pendingProfile]) d.pendingProfile = REPLACED_PROFILES[d.pendingProfile];
  }
  for (const m of db.data.messages || []) if (Array.isArray(m.targets)) m.targets = m.targets.filter((t) => !REPLACED_PROFILES[t]);
  db.data.profilesVersion = Math.max(13, db.data.profilesVersion || 1);
  db.save();
})();

// v14: the shared Midweek dashboard (every screen shows it Mon–Sat).
(function addMidweek() {
  if ((db.data.profilesVersion || 1) >= 14) return;
  if (!db.data.profiles.midweek) db.data.profiles.midweek = structuredClone(dbDefaults.profiles.midweek);
  db.data.profilesVersion = 14;
  db.save();
})();

// Push dashboards designed in the builder (see LAYOUT_REVISIONS in defaults.js).
(function applyLayoutRevisions() {
  const done = (db.data.layoutRevisions = db.data.layoutRevisions || {});
  let changed = false;
  for (const [key, rev] of Object.entries(LAYOUT_REVISIONS)) {
    if ((done[key] || 0) >= rev) continue;
    const [id, phase] = key.split('.');
    const def = dbDefaults.profiles[id];
    if (!def || !def.layouts[phase]) continue;
    if (!db.data.profiles[id]) db.data.profiles[id] = structuredClone(def);
    db.data.profiles[id].layouts[phase] = structuredClone(def.layouts[phase]);
    done[key] = rev;
    changed = true;
  }
  if (changed) db.save();
})();

(function migrateProfiles() {
  let changed = false;
  for (const [id, p] of Object.entries(db.data.profiles)) {
    if (p.layouts.huddle && !p.layouts.pre) {
      p.layouts.pre = p.layouts.huddle;
      changed = true;
    }
    if (p.layouts.huddle) {
      delete p.layouts.huddle;
      changed = true;
    }
    if (!p.layouts.pre) {
      p.layouts.pre = structuredClone((dbDefaults.profiles[id] && dbDefaults.profiles[id].layouts.pre) || p.layouts.live);
      changed = true;
    }
    if (!p.modeSetting) {
      p.modeSetting = p.autoMode || !p.mode ? 'auto' : p.mode === 'huddle' ? 'pre' : p.mode;
      changed = true;
    }
    if ('autoMode' in p || 'mode' in p) {
      delete p.autoMode;
      delete p.mode;
      changed = true;
    }
  }
  // Third phase: a Preshow dashboard for every room (starts as a copy of Live).
  for (const p of Object.values(db.data.profiles)) {
    if (!p.layouts.preshow) {
      p.layouts.preshow = preshowFrom(p.layouts.live);
      changed = true;
    }
  }
  if (db.data.schedule && db.data.schedule.preshowLeadMinutes == null) {
    db.data.schedule.preshowLeadMinutes = 5;
    changed = true;
  }
  if (!db.data.devices) {
    db.data.devices = {};
    changed = true;
  }
  if (changed) db.saveNow();
})();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

const PUBLIC = path.join(__dirname, '..', 'public');
// TV pages and their scripts go out rewritten for older TV browsers (legacy.js).
const legacy = require('./legacy');
app.use('/static', legacy.scripts(PUBLIC, ['display.js', 'widgets.js']));
app.use('/static', express.static(PUBLIC, { maxAge: '1h' }));
app.use('/photos', express.static(PHOTO_DIR, { maxAge: '1d' }));
app.use('/seed-photos', express.static(path.join(__dirname, 'seed', 'photos'), { maxAge: '1d' }));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/display', legacy.sendPage(path.join(PUBLIC, 'chooser.html')));
app.get('/display/:profile', legacy.sendPage(path.join(PUBLIC, 'display.html')));

const ok = (res, body = { ok: true }) => res.json(body);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- public ----------
// Every dashboard, grouped by location, in room-picker order. Public so
// screens (and the TVs' own launcher) can list them without signing in.
function displayList() {
  const rank = (l) => {
    const i = LOCATIONS.indexOf(l);
    return i < 0 ? LOCATIONS.length : i;
  };
  return Object.entries(db.data.profiles)
    .filter(([, p]) => !String(p.location || '').startsWith('_')) // _Mock etc. stay out of the room picker
    .map(([id, p], i) => ({ id, name: p.name, location: p.location || 'Other', i }))
    .sort((a, b) => rank(a.location) - rank(b.location) || a.location.localeCompare(b.location) || a.i - b.i)
    .map(({ i, ...d }) => ({ ...d, url: '/display/' + d.id }));
}
app.get('/api/displays', (req, res) => ok(res, displayList()));
// Slide thumbnails from ProPresenter, for the slide preview widget.
app.get('/prop-thumb/:source/:uuid/:index', async (req, res) => {
  const idx = Number(req.params.index);
  if (!['auditorium', 'broadcast'].includes(req.params.source) || !/^[A-Za-z0-9-]{8,64}$/.test(req.params.uuid) || !Number.isInteger(idx)) return res.status(400).end();
  const img = await engine.propThumbnail(req.params.source, req.params.uuid, idx);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(img.body);
});

app.get('/api/locations', (req, res) => {
  const out = [];
  for (const d of displayList()) {
    let l = out.find((x) => x.name === d.location);
    if (!l) out.push((l = { name: d.location, slug: d.location.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), dashboards: [] }));
    l.dashboards.push({ id: d.id, name: d.name, url: d.url });
  }
  ok(res, out);
});

// Which dashboard a screen was last on (or was moved to while it was off).
// Lets a TV whose browser storage was wiped go straight back to its room.
app.get('/api/devices/:id/room', (req, res) => {
  const d = db.data.devices[req.params.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)];
  const room = d && (d.pendingProfile || d.profile);
  ok(res, { profile: room && db.data.profiles[room] ? room : null });
});

// A screen picked its room on the picker page.
app.post('/api/devices/:id/choose', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const profile = (req.body || {}).profile;
  if (!id || !db.data.profiles[profile]) return bad(res, 'Unknown room.');
  const cur = db.data.devices[id] || {};
  const nm = String((req.body || {}).name || '').trim().slice(0, 40);
  db.data.devices[id] = { ...cur, name: cur.name || nm || 'Screen ' + id.slice(0, 4).toUpperCase(), profile, lastSeen: Date.now() };
  db.save();
  ok(res);
});

app.get('/api/setup-needed', (req, res) => ok(res, { needed: db.data.accounts.length === 0 }));

app.post('/api/setup', (req, res) => {
  if (db.data.accounts.length) return bad(res, 'Setup is already done.', 403);
  const { name, pin } = req.body || {};
  if (!name || !/^\d{4,8}$/.test(String(pin || ''))) return bad(res, 'Enter your name and a 4–8 digit PIN.');
  const a = auth.createAccount({ name, pcoName: req.body.pcoName || name, role: 'admin', pin });
  // The first admin is the overall administrator: nobody else can change or
  // remove this account, not even the Technical Director.
  a.owner = true;
  db.save();
  const token = auth.login(a.id, pin);
  setCookie(res, token);
  log(`First admin created: ${a.name}`);
  ok(res, { account: auth.publicAccount(a) });
});

app.get('/api/accounts/public', (req, res) => {
  ok(res, db.data.accounts.map((a) => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name)));
});

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `lcd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}

// Roles for the sign-in screen, with who's scheduled in each one today.
app.get('/api/roles/public', (req, res) => {
  ok(res, (db.data.roles || []).map((r) => ({ id: r.id, name: r.name, hasPin: !!r.pinHash, person: auth.scheduledFor(r.name) })));
});

app.post('/api/login-role', (req, res) => {
  const { roleId, pin } = req.body || {};
  const r = auth.loginRole(String(roleId || ''), String(pin || ''));
  if (typeof r !== 'string') return bad(res, r.error, 401);
  setCookie(res, r);
  const role = db.data.roles.find((x) => x.id === roleId);
  log(`Signed in as ${role.name}`);
  ok(res);
});

app.post('/api/login', (req, res) => {
  const { accountId, pin } = req.body || {};
  const token = auth.login(accountId, pin);
  if (typeof token !== 'string') return bad(res, token.error, 401);
  setCookie(res, token);
  ok(res, { account: auth.publicAccount(db.data.accounts.find((a) => a.id === accountId)) });
});

app.post('/api/logout', (req, res) => {
  auth.logout(req);
  res.setHeader('Set-Cookie', 'lcd_session=; Path=/; Max-Age=0');
  ok(res);
});

app.get('/api/me', (req, res) => {
  const a = auth.sessionAccount(req);
  ok(res, { account: auth.publicAccount(a), canSend: a ? canSend(a).ok : false, reason: a ? canSend(a).reason : '' });
});

// ---------- leaders: messages + live control ----------
function canSend(account) {
  if (account.role === 'admin') return { ok: true };
  if (account.isRole) return account.perms.includes('messages') ? { ok: true } : { ok: false, reason: 'Your role can’t send messages.' };
  if (!config.data.onlyScheduledLeaders || config.data.sampleMode) return { ok: true };
  const plan = engine.getPlan();
  const roles = config.data.leaderRoles || [];
  const scheduled = plan && plan.people.some((p) => p.name.toLowerCase() === account.pcoName.toLowerCase() && roles.includes(p.position));
  return scheduled ? { ok: true } : { ok: false, reason: 'You can send messages on days you’re scheduled in a leadership role.' };
}

app.get('/api/messages', auth.requireLeader, (req, res) => {
  const since = Date.now() - 18 * 3600e3;
  ok(res, {
    messages: db.data.messages.filter((m) => m.at > since).slice(-100).reverse(),
    quick: db.data.quickMessages,
    displays: Object.entries(db.data.profiles).map(([id, p]) => ({ id, name: p.name })),
    defaultSeconds: config.data.messageDefaultSeconds,
  });
});

app.post('/api/messages', auth.requirePerm('messages'), (req, res) => {
  const perm = canSend(req.account);
  if (!perm.ok) return bad(res, perm.reason, 403);
  const { text, level, targets, seconds } = req.body || {};
  const t = String(text || '').trim().slice(0, 140);
  if (!t) return bad(res, 'Type a message first.');
  const secs = Math.max(0, Math.min(3600, Number(seconds ?? config.data.messageDefaultSeconds) || 0));
  const m = {
    id: crypto.randomUUID(),
    text: t,
    level: ['info', 'heads', 'urgent'].includes(level) ? level : 'info',
    targets: Array.isArray(targets) && targets.length ? targets : ['all'],
    from: req.account.name,
    at: Date.now(),
    expiresAt: secs ? Date.now() + secs * 1000 : null,
    cleared: false,
  };
  db.data.messages.push(m);
  if (db.data.messages.length > 2000) db.data.messages = db.data.messages.slice(-1000);
  db.save();
  log(`Message from ${m.from} → ${m.targets.join(',')}: ${m.text}`);
  pushNow();
  ok(res, { message: m });
});

app.post('/api/messages/:id/clear', auth.requirePerm('messages'), (req, res) => {
  const m = db.data.messages.find((x) => x.id === req.params.id);
  if (!m) return bad(res, 'Message not found.', 404);
  m.cleared = true;
  m.clearedBy = req.account.name;
  db.save();
  pushNow();
  ok(res);
});

app.post('/api/messages/clear-all', auth.requirePerm('messages'), (req, res) => {
  db.data.messages.forEach((m) => {
    if (!m.cleared) {
      m.cleared = true;
      m.clearedBy = req.account.name;
    }
  });
  db.save();
  pushNow();
  ok(res);
});

app.get('/api/live', auth.requireLeader, (req, res) => {
  const s = engine.snapshot();
  ok(res, {
    encounter: s.encounter,
    preshowPoints: s.preshowPoints,
    messageNotes: s.messageNotes,
    announcements: s.announcements,
    midweek: s.midweek,
    messageNotesTyped: (db.data.messageNotes && engine.getPlan() && db.data.messageNotes.date === engine.getPlan().date && db.data.messageNotes.text) || '',
    isLive: s.isLive,
    items: s.items,
    index: s.index,
    indexSource: s.indexSource,
    remaining: s.itemRemainingMs,
    now: s.now,
    propresenter: { auditorium: s.propresenter.auditorium.connected, presentation: s.propresenter.auditorium.presentation || '' },
    unmatched: s.unmatchedPresentation || '',
    links: db.data.presentationLinks || {},
    preshow: s.preshow,
    preshowSeconds: db.data.schedule.preshowSeconds ?? 270,
  });
});

// Preshow: start now / end / back to the schedule.
// ---------- updates ----------
// Admin → Settings shows which version is running, whether GitHub has a newer
// one, and an Update button that runs scripts/update.sh (data is kept and
// backed up). Nothing updates by itself.
const UPDATE_REPO = 'jozefkuehn-oss/Love_Church_Production_Displays';
let latestCache = { at: 0, data: null };
async function latestVersion() {
  if (latestCache.data && Date.now() - latestCache.at < 10 * 60e3) return latestCache.data;
  let data = null;
  const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/commits/main`, { headers: { 'User-Agent': 'lc-displays', Accept: 'application/vnd.github+json' } }).catch(() => null);
  if (r && r.ok) {
    const j = await r.json();
    data = { sha: j.sha, date: j.commit && j.commit.committer && j.commit.committer.date, message: ((j.commit && j.commit.message) || '').split('\n')[0] };
  } else {
    // GitHub's API limits how often it can be asked; the commits feed works too.
    const f = await fetch(`https://github.com/${UPDATE_REPO}/commits/main.atom`, { headers: { 'User-Agent': 'lc-displays' } });
    if (!f.ok) throw new Error('GitHub said ' + f.status);
    const x = await f.text();
    const entry = x.slice(x.indexOf('<entry>'));
    const sha = (entry.match(/Commit\/([0-9a-f]{40})/) || [])[1];
    if (!sha) throw new Error('unexpected reply');
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    data = { sha, date: (entry.match(/<updated>([^<]+)<\/updated>/) || [])[1], message: title.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") };
  }
  latestCache = { at: Date.now(), data };
  return data;
}
function currentVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR_FOR_UPDATES, 'version.json'), 'utf8'));
  } catch (e) {
    try {
      const sha = require('child_process').execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      return { sha, updatedAt: '' };
    } catch (e2) {
      return { sha: '', updatedAt: '' };
    }
  }
}
const DATA_DIR_FOR_UPDATES = process.env.LCD_DATA_DIR || path.join(__dirname, '..', 'data');
const managedByLaunchd = () => fs.existsSync(path.join(require('os').homedir(), 'Library', 'LaunchAgents', 'org.lovechurch.displays.plist'));
app.get('/api/version', auth.requireAdmin, async (req, res) => {
  const cur = currentVersion();
  let latest = null, error = '';
  try {
    latest = await latestVersion();
  } catch (e) {
    error = 'Couldn’t reach GitHub to check (' + e.message + ').';
  }
  ok(res, { current: cur, latest, error, updateAvailable: !!(latest && latest.sha !== cur.sha), managed: managedByLaunchd(), lastLog: (() => { try { return fs.readFileSync(path.join(DATA_DIR_FOR_UPDATES, 'logs', 'update.log'), 'utf8').trim().split('\n').slice(-6).join('\n'); } catch (e) { return ''; } })() });
});
app.post('/api/update', auth.requireAdmin, (req, res) => {
  const script = path.join(__dirname, '..', 'scripts', 'update.sh');
  if (process.platform !== 'darwin' && process.platform !== 'linux') return bad(res, 'Updates from the app only work on the Mac.');
  log(`Update started by ${req.account.name}`);
  ok(res, { managed: managedByLaunchd() });
  setTimeout(() => {
    const child = require('child_process').spawn('bash', [script, '--from-app'], { detached: true, stdio: 'ignore', cwd: path.join(__dirname, '..') });
    child.unref();
  }, 300);
});

// Rehearsal: run everything as if it were Sunday at a chosen time (real plan,
// real ProPresenter and receivers), to test midweek. Ends after 3 hours.
function nextSundayKey() {
  const p = parts(Date.now(), config.data.timezone);
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
// The loaded plan's Sunday if it's today or later, otherwise the coming Sunday.
function rehearsalDate(plan) {
  const today = parts(Date.now(), config.data.timezone).dateKey;
  return plan && plan.date && plan.date >= today ? plan.date : nextSundayKey();
}
app.get('/api/rehearsal', auth.requirePerm('rehearsal'), (req, res) => {
  const r = clock.rehearsal();
  const plan = engine.getPlan();
  ok(res, { active: !!r, time: r ? r.time : '', date: r ? r.dateKey : '', until: r ? r.until : 0, nextSunday: rehearsalDate(plan) });
});
app.post('/api/rehearsal', auth.requirePerm('rehearsal'), async (req, res) => {
  const time = String((req.body || {}).time || '');
  if (!/^\d{1,2}:\d{2}$/.test(time)) return bad(res, 'Pick a start time.');
  const plan = engine.getPlan();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((req.body || {}).date || '')) ? req.body.date : rehearsalDate(plan);
  clock.startRehearsal(date, time);
  log(`Rehearsal started (${date} ${time}) by ${req.account.name}`);
  await engine.refreshPlan().catch(() => {});
  pushNow();
  ok(res);
});
app.delete('/api/rehearsal', auth.requirePerm('rehearsal'), async (req, res) => {
  clock.stopRehearsal();
  log(`Rehearsal stopped by ${req.account.name}`);
  await engine.refreshPlan().catch(() => {});
  pushNow();
  ok(res);
});

// Subs: when someone doesn't show, put someone else in their spot for today.
// Every screen (face cards, mics, go-to people, the 11:45 crew) uses the sub.
const SUB_TEAMS = [/worship/i, /communicator/i, /broadcast/i, /production/i, /service management/i];
app.get('/api/subs', auth.requirePerm('subs'), (req, res) => {
  engine.snapshot();
  const plan = engine.getPlan();
  if (!plan) return ok(res, { groups: [], names: [] });
  const S = db.data.subs && db.data.subs.date === plan.date ? db.data.subs : {};
  const encLabels = ((db.data.schedule && db.data.schedule.encounters) || []).map((e) => e.label);
  const groups = [];
  for (const p of plan.people) {
    if (!SUB_TEAMS.some((re) => re.test(p.team || ''))) continue;
    let g = groups.find((x) => x.team === p.team);
    if (!g) groups.push((g = { team: p.team, rows: [] }));
    const key = engine.subKey(p);
    const byEnc = {};
    for (const l of encLabels) if (((S.byEnc || {})[l] || {})[key]) byEnc[l] = S.byEnc[l][key];
    g.rows.push({ key, position: p.position, name: p.name, sub: (S.byKey || {})[key] || '', byEnc, status: p.status });
  }
  // Each team offers only its own people: everyone assigned to that team in
  // Planning Center, plus anyone on it this week. Until the rosters have
  // loaded (or in sample mode) it falls back to everyone.
  // Each spot offers only the right people from Planning Center: first
  // whoever is assigned to that same position, then the rest of the team.
  // Communicators are narrower: a host spot offers the Encounter / Online
  // hosts and co-hosts, any other spot (Bible Teacher, TIP Host…) only people
  // in that exact position. Until the rosters load (or in sample mode) it
  // falls back to everyone.
  const R = engine.getTeamRosters() || {};
  const teamsR = R.teams || {};
  const posR = R.positions || {};
  const haveRosters = Object.keys(teamsR).length > 0;
  const everyone = [...new Set([...plan.people.map((p) => p.name), ...photos.roster()])].sort(byFirst);
  const HOST = /^(encounter|online)\s+(co-?\s*)?host$/i;
  for (const g of groups) {
    const comm = /communicator/i.test(g.team);
    const teamAll = [...new Set([...(teamsR[g.team] || []), ...plan.people.filter((p) => p.team === g.team).map((p) => p.name)])].sort(byFirst);
    for (const row of g.rows) {
      if (!haveRosters) {
        row.names = everyone;
        continue;
      }
      const posKeys = Object.keys(posR).filter((k) => {
        const [t, pos] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
        if (t !== g.team) return false;
        if (pos === row.position) return true;
        return comm && HOST.test(row.position) && HOST.test(pos);
      });
      const same = new Set(posKeys.flatMap((k) => posR[k]));
      plan.people.filter((p) => p.team === g.team && (p.position === row.position || (comm && HOST.test(row.position) && HOST.test(p.position)))).forEach((p) => same.add(p.name));
      const first = [...same].sort(byFirst);
      row.names = comm ? first : [...first, ...teamAll.filter((n) => !same.has(n))];
    }
  }
  groups.sort((a, b) => SUB_TEAMS.findIndex((re) => re.test(a.team)) - SUB_TEAMS.findIndex((re) => re.test(b.team)));
  ok(res, { date: plan.date, encounters: encLabels, groups, names: everyone });
});
app.put('/api/subs', auth.requirePerm('subs'), (req, res) => {
  const plan = engine.getPlan();
  if (!plan) return bad(res, 'No plan loaded yet.');
  const { key } = req.body || {};
  if (!plan.people.some((p) => engine.subKey(p) === key)) return bad(res, 'That spot isn’t on today’s plan.');
  if (!db.data.subs || db.data.subs.date !== plan.date) db.data.subs = { date: plan.date, byKey: {}, byEnc: {} };
  db.data.subs.byEnc = db.data.subs.byEnc || {};
  const enc = String((req.body || {}).encounter || '');
  const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const orig = key.split('|')[2];
  // encounter '' = all day; otherwise just that Encounter.
  const bucket = enc ? (db.data.subs.byEnc[enc] = db.data.subs.byEnc[enc] || {}) : db.data.subs.byKey;
  if (name && name !== orig) bucket[key] = name;
  else delete bucket[key];
  db.save();
  log(`Sub${enc ? ' (' + enc + ')' : ''}: ${key} → ${name || '(back to scheduled)'} by ${req.account.name}`);
  pushNow();
  ok(res);
});

// Recording an unstreamed Encounter (the 11:45): on/off for this Sunday, and
// who's on the crew that stays (defaults to whoever PCO has in each position).
function recordLabel() {
  const encs = (db.data.schedule && db.data.schedule.encounters) || [];
  const e = encs.find((x) => !x.streamStart && !x.streamEnd);
  return e ? e.label : '';
}
app.get('/api/recording', auth.requirePerm('recording'), (req, res) => {
  engine.snapshot();
  const plan = engine.getPlan();
  const r = db.data.recording && plan && db.data.recording.date === plan.date ? db.data.recording : null;
  const names = [...new Set([...((plan && plan.people) || []).map((p) => p.name), ...photos.roster()])].sort(byFirst);
  const cur = r && r.on ? engine.recordCrew() : [];
  ok(res, {
    on: !!(r && r.on),
    label: (r && r.label) || recordLabel(),
    crew: engine.RECORD_CREW.map((pos) => {
      const c = cur.find((x) => x.position === pos);
      const fromPlan = ((plan && plan.people) || []).find((p) => p.position === pos);
      return { position: pos, name: c ? c.name : (r && r.crew && r.crew[pos]) || (fromPlan ? fromPlan.name : ''), planName: fromPlan ? fromPlan.name : '' };
    }),
    names,
  });
});
app.put('/api/recording', auth.requirePerm('recording'), (req, res) => {
  const plan = engine.getPlan();
  if (!plan) return bad(res, 'No plan loaded yet.');
  const body = req.body || {};
  const label = recordLabel();
  if (!label) return bad(res, 'There’s no unstreamed Encounter in the Schedule to record.');
  const prev = db.data.recording && db.data.recording.date === plan.date ? db.data.recording : { crew: {} };
  const crew = { ...(prev.crew || {}) };
  for (const [pos, name] of Object.entries(body.crew || {})) {
    if (!engine.RECORD_CREW.includes(pos)) continue;
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (n) crew[pos] = n;
    else delete crew[pos];
  }
  db.data.recording = { date: plan.date, label, on: body.on != null ? !!body.on : !!prev.on, crew };
  db.save();
  log(`Recording the ${label}: ${db.data.recording.on ? 'on' : 'off'} (${req.account.name})`);
  pushNow();
  ok(res);
});

// Midweek screen announcements (any leader who can run the Live page).
app.put('/api/announcements', auth.requirePerm('live'), (req, res) => {
  db.data.announcements = String((req.body || {}).text || '').slice(0, 4000);
  db.save();
  log(`Midweek announcements updated by ${req.account.name}`);
  pushNow();
  ok(res);
});

// Message notes for this Sunday, when they aren't in the PCO Message item's
// Details (or need fixing). Empty text = go back to what PCO has.
app.put('/api/message-notes', auth.requirePerm('live'), (req, res) => {
  const plan = engine.getPlan();
  const text = String((req.body || {}).text || '').slice(0, 60000);
  db.data.messageNotes = { date: plan ? plan.date : '', text };
  db.save();
  log(`Message notes ${text.trim() ? 'updated' : 'cleared'} by ${req.account.name}`);
  pushNow();
  ok(res);
});

// Pre-/Post-Show Teleprompter talking points.
app.put('/api/preshow-points', auth.requirePerm('live'), (req, res) => {
  const text = String((req.body || {}).text || '').slice(0, 2000);
  db.data.preshowPoints = text;
  db.save();
  log(`Preshow points updated by ${req.account.name}`);
  pushNow();
  ok(res);
});

app.post('/api/preshow/:action', auth.requirePerm('live'), (req, res) => {
  const a = req.params.action;
  if (!['start', 'end', 'reset'].includes(a)) return bad(res, 'Unknown action.');
  const label = engine.preshowAction(a, (req.body || {}).label);
  if (!label) return bad(res, 'No Encounter to run a preshow for.');
  log(`Preshow ${a} (${label}) by ${req.account.name}`);
  pushNow();
  ok(res);
});

// Link a ProPresenter presentation name to a plan item (remembered for future Sundays).
app.post('/api/live-link', auth.requirePerm('live'), (req, res) => {
  const { presentation, item } = req.body || {};
  if (!presentation) return bad(res, 'No presentation name.');
  db.data.presentationLinks = db.data.presentationLinks || {};
  if (item) db.data.presentationLinks[String(presentation)] = String(item);
  else delete db.data.presentationLinks[String(presentation)];
  db.save();
  log(`${req.account.name} linked presentation "${presentation}" → ${item || '(nothing)'}`);
  pushNow();
  ok(res);
});

// Manual "where are we" control for when ProPresenter isn't tracking.
app.post('/api/live/:action', auth.requirePerm('live'), (req, res) => {
  const s = engine.snapshot();
  const live = db.data.live;
  const n = s.items.length;
  if (req.params.action === 'auto') {
    live.manualIndex = null;
  } else if (req.params.action === 'set') {
    live.manualIndex = Math.max(0, Math.min(n - 1, Number(req.body.index) || 0));
  } else if (req.params.action === 'next') {
    live.manualIndex = Math.min(n - 1, (s.index ?? -1) + 1);
  } else if (req.params.action === 'prev') {
    live.manualIndex = Math.max(0, (s.index ?? 1) - 1);
  } else return bad(res, 'Unknown action');
  live.manualEnc = s.encounter && s.encounter.label;
  live.manualSetAt = clock.now();
  db.save();
  pushNow();
  ok(res);
});

// ---------- admin ----------
const SECRET_FIELDS = [['pco', 'secret'], ['slack', 'botToken']];
const MASK = '••••••••';

app.get('/api/config', auth.requireAdmin, (req, res) => {
  const c = structuredClone(config.data);
  for (const [a, b] of SECRET_FIELDS) if (c[a][b]) c[a][b] = MASK;
  ok(res, c);
});

app.put('/api/config', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  for (const [a, b] of SECRET_FIELDS) if (body[a] && body[a][b] === MASK) body[a][b] = config.data[a][b];
  const wasSample = config.data.sampleMode;
  const allowed = ['sampleMode', 'demoStart', 'timezone', 'campusLabel', 'pco', 'slack', 'propresenter', 'leaderRoles', 'onlyScheduledLeaders', 'messageDefaultSeconds', 'hideItems', 'midweek'];
  for (const k of allowed) if (k in body) config.data[k] = body[k];
  config.saveNow();
  engine.restartProPresenter();
  if (wasSample !== config.data.sampleMode || body.pco) engine.refreshPlan().then(engine.refreshHosts).then(engine.refreshPhotos);
  log(`Settings updated by ${req.account.name}`);
  ok(res);
});

app.post('/api/refresh', auth.requireAdmin, async (req, res) => {
  await engine.refreshPlan();
  await engine.refreshHosts(); // team rosters + Planning Center photos
  await engine.refreshPhotos(); // Slack photos (only changed ones download)
  pushNow();
  ok(res, engine.health());
});

app.get('/api/health', auth.requireLeader, (req, res) => ok(res, engine.health()));

app.get('/api/schedule', auth.requireAdmin, (req, res) => ok(res, db.data.schedule));
app.put('/api/schedule', auth.requireAdmin, (req, res) => {
  const s = req.body || {};
  const hm = /^\d{2}:\d{2}$/;
  for (const e of [...(s.encounters || []), ...Object.values(s.overrides || {}).flatMap((o) => o.encounters || [])]) {
    if (!hm.test(e.start) || (e.streamStart && !hm.test(e.streamStart)) || (e.streamEnd && !hm.test(e.streamEnd))) return bad(res, 'Times must be HH:MM (24-hour).');
    if (e.preshowEnd && !/^\d{2}:\d{2}(:\d{2})?$/.test(e.preshowEnd)) return bad(res, 'Preshow end must be a time like 08:44:30.');
  }
  if (s.preshowSeconds != null) s.preshowSeconds = Math.max(30, Math.min(1800, Number(s.preshowSeconds) || 270));
  db.data.schedule = { ...db.data.schedule, ...s };
  db.save();
  pushNow();
  ok(res);
});

app.get('/api/quick', auth.requireLeader, (req, res) => ok(res, db.data.quickMessages));
app.put('/api/quick', auth.requireAdmin, (req, res) => {
  db.data.quickMessages = (req.body.quick || []).map((s) => String(s).slice(0, 80)).filter(Boolean);
  db.save();
  ok(res);
});

// People: who's scheduled (or, with ?all=1, everyone the app knows about),
// their photo source and framing.
app.get('/api/people', auth.requireAdmin, (req, res) => {
  const plan = engine.getPlan();
  const slack = engine.getSlackPhotos();
  const pcoPics = engine.getPcoPhotos();
  const ghPics = engine.getGhPhotos();
  const onPlan = new Map();
  for (const p of (plan && plan.people) || []) onPlan.set(p.name, [...(onPlan.get(p.name) || []), p.position]);
  let names = [...onPlan.keys()];
  if (req.query.all) {
    const added = Object.keys(db.data.people || {});
    names = [...new Set([...names, ...photos.roster(), ...added])].sort((a, b) => a.localeCompare(b));
  }
  ok(res, {
    people: names.map((name) => {
      const o = db.data.people[name] || {};
      return {
        name,
        positions: [...new Set(onPlan.get(name) || [])],
        onPlan: onPlan.has(name),
        override: o,
        slackPhoto: ghPics[name] || slack[name] || '',
        pcoPhoto: pcoPics[name] || '',
        seedPhoto: photos.seedPhoto(name),
        slackName: db.data.nameMap[name] || '',
      };
    }),
    helpText: db.data.helpText,
  });
});

// Add someone who isn't on the plan or the roster yet, so a photo can be
// ready before they serve.
app.post('/api/people', auth.requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return bad(res, 'Type the person’s full name as it appears in Planning Center.');
  db.data.people[name] = db.data.people[name] || {};
  db.save();
  ok(res, { name });
});

app.put('/api/people/:name', auth.requireAdmin, (req, res) => {
  const name = req.params.name;
  const cur = db.data.people[name] || {};
  const b = req.body || {};
  const num = (v, lo, hi, dflt) => (v === undefined ? dflt : Math.max(lo, Math.min(hi, Number(v))));
  db.data.people[name] = {
    ...cur,
    focusX: num(b.focusX, 0, 100, cur.focusX ?? 50),
    focusY: num(b.focusY, 0, 100, cur.focusY ?? 15),
    zoom: num(b.zoom, 1, 3, cur.zoom ?? 1),
    hidePhoto: b.hidePhoto ?? cur.hidePhoto ?? false,
    usePco: b.usePco ?? cur.usePco ?? false,
  };
  if (b.reset) Object.assign(db.data.people[name], { focusX: 50, focusY: 15, zoom: 1 });
  if ('slackName' in b) {
    if (b.slackName) db.data.nameMap[name] = String(b.slackName);
    else delete db.data.nameMap[name];
  }
  db.save();
  pushNow();
  ok(res);
});

app.post('/api/people/:name/photo', auth.requireAdmin, (req, res) => {
  const m = String((req.body || {}).dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!m) return bad(res, 'Upload a JPG, PNG or WebP image.');
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const file = `upload-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), Buffer.from(m[2], 'base64'));
  const name = req.params.name;
  db.data.people[name] = { ...(db.data.people[name] || {}), photo: `/photos/${file}`, hidePhoto: false, focusX: 50, focusY: 15, zoom: 1 };
  db.save();
  pushNow();
  ok(res, { photo: `/photos/${file}` });
});

app.delete('/api/people/:name/photo', auth.requireAdmin, (req, res) => {
  const p = db.data.people[req.params.name];
  if (p) delete p.photo;
  db.save();
  pushNow();
  ok(res);
});

app.put('/api/helptext', auth.requireAdmin, (req, res) => {
  db.data.helpText = req.body || {};
  db.save();
  pushNow();
  ok(res);
});

// Song bank
app.get('/api/songs', auth.requireAdmin, (req, res) => ok(res, db.data.songs));
app.put('/api/songs/:key', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  const key = engine.songKey(b.title || req.params.key) || req.params.key;
  if (key !== req.params.key) delete db.data.songs[req.params.key];
  db.data.songs[key] = { title: b.title || '', lead: b.lead || '', feel: b.feel || '', progression: b.progression || '', notes: b.notes || '', cue: b.cue || '' };
  db.save();
  pushNow();
  ok(res, { key });
});
app.delete('/api/songs/:key', auth.requireAdmin, (req, res) => {
  delete db.data.songs[req.params.key];
  db.save();
  pushNow();
  ok(res);
});

// Wireless channel assignments (by Planning Center position)
app.get('/api/wireless', auth.requireAdmin, (req, res) => ok(res, db.data.wireless || {}));
app.put('/api/wireless', auth.requireAdmin, (req, res) => {
  db.data.wireless = req.body || {};
  db.save();
  pushNow();
  ok(res);
});

// Networked mic receivers (Shure Axient Digital) and what they report live.
app.get('/api/wireless-live', auth.requirePerm('wireless'), (req, res) => {
  ok(res, {
    receivers: (config.data.wireless || {}).receivers || [],
    status: engine.health().wireless.receivers,
    channels: Object.values(engine.wirelessChannels()),
  });
});
// This Sunday: who has which mic/IEM on the current plan.
app.get('/api/wireless-week', auth.requirePerm('wireless'), (req, res) => {
  engine.snapshot();
  const plan = engine.getPlan();
  const wk = db.data.wirelessWeek && plan && db.data.wirelessWeek.date === plan.date ? db.data.wirelessWeek.byName || {} : {};
  ok(res, {
    date: plan ? plan.date : '',
    rows: engine.wirelessRows().map((r) => ({ ...r, pickMic: (wk[r.name] || {}).mic || '', pickIem: (wk[r.name] || {}).iem || '' })),
  });
});
app.put('/api/wireless-week', auth.requirePerm('wireless'), (req, res) => {
  const plan = engine.getPlan();
  if (!plan) return bad(res, 'No plan loaded yet.');
  const byName = {};
  for (const [name, v] of Object.entries((req.body || {}).byName || {})) {
    const mic = String((v && v.mic) || '').slice(0, 20);
    const iem = String((v && v.iem) || '').slice(0, 20);
    if (mic || iem) byName[String(name).slice(0, 80)] = { ...(mic ? { mic } : {}), ...(iem ? { iem } : {}) };
  }
  const keepHH = db.data.wirelessWeek && db.data.wirelessWeek.date === plan.date ? db.data.wirelessWeek.handhelds || {} : {};
  db.data.wirelessWeek = { date: plan.date, byName, handhelds: keepHH };
  db.save();
  pushNow();
  ok(res);
});

// Speaking mics: the Floor Manager (or FOH / producers) says who has each
// handheld, the teaching mic and the belt packs right now.
const HANDHELDS = ['HH-1', 'HH-2', 'TEACH', 'BP-1', 'BP-2'];
function weekDoc() {
  const plan = engine.getPlan();
  if (!plan) return null;
  if (!db.data.wirelessWeek || db.data.wirelessWeek.date !== plan.date) db.data.wirelessWeek = { date: plan.date, byName: {}, handhelds: {} };
  db.data.wirelessWeek.handhelds = db.data.wirelessWeek.handhelds || {};
  return db.data.wirelessWeek;
}
// Floor Manager list: today's communicators, the usual Encounter/Online
// hosts, and anyone who has had a handheld before — alphabetical by first name.
// "everyone" (for search) adds the whole plan and the serving roster.
const byFirst = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
app.get('/api/handhelds', auth.requirePerm(['handhelds', 'wireless']), (req, res) => {
  engine.snapshot();
  const plan = engine.getPlan();
  const wk = db.data.wirelessWeek && plan && db.data.wirelessWeek.date === plan.date ? db.data.wirelessWeek.handhelds || {} : {};
  const rows = engine.wirelessRows();
  const live = engine.wirelessChannels();
  const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const planPeople = (plan && plan.people) || [];
  const communicators = planPeople.filter((p) => /communicator/i.test(p.team || '')).map((p) => p.name);
  const quick = [...new Set([...communicators, ...engine.getHosts(), ...(db.data.handheldHistory || [])])].sort(byFirst);
  const everyone = [...new Set([...quick, ...planPeople.map((p) => p.name), ...photos.roster()])].sort(byFirst);
  ok(res, {
    date: plan ? plan.date : '',
    quick,
    everyone,
    handhelds: HANDHELDS.map((ch) => {
      const holder = rows.find((r) => norm(r.mic) === norm(ch));
      const l = live[norm(ch)];
      return { ch, name: holder ? holder.name : '', set: !!(wk[ch] && wk[ch].name), by: (wk[ch] || {}).by || '', at: (wk[ch] || {}).at || 0, live: l ? { battery: l.battery, minutes: l.minutes, rf: l.rf, tx: l.tx, online: l.online } : null };
    }),
  });
});
app.put('/api/handhelds/:ch', auth.requirePerm(['handhelds', 'wireless']), (req, res) => {
  const ch = HANDHELDS.find((x) => x.replace('-', '') === String(req.params.ch).toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (!ch) return bad(res, 'Unknown mic.');
  const wk = weekDoc();
  if (!wk) return bad(res, 'No plan loaded yet.');
  const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name) {
    wk.handhelds[ch] = { name, by: req.account.name, at: Date.now() };
    // Remember who has held a handheld, so they're in the quick list next time.
    db.data.handheldHistory = [...new Set([name, ...(db.data.handheldHistory || [])])].slice(0, 60);
    // Tell every screen except the Dock, flashing red/yellow, for 45 seconds.
    // If a MIC CHANGE banner is still up (e.g. HH-1 was just given out for
    // preshow), this one joins it so both names show, in mic order.
    const targets = Object.entries(db.data.profiles).filter(([, p]) => (p.location || '') !== 'The Dock').map(([id]) => id);
    const nowMs = Date.now();
    const mics = {};
    for (const m of db.data.messages) {
      if (m.mics && !m.cleared && (!m.expiresAt || m.expiresAt > nowMs)) {
        Object.assign(mics, m.mics);
        m.cleared = true;
      }
    }
    mics[ch] = name;
    const order = (c) => (HANDHELDS.indexOf(c) < 0 ? 99 : HANDHELDS.indexOf(c));
    const text = Object.keys(mics).sort((x, y) => order(x) - order(y)).map((c) => `${c} → ${mics[c]}`).join('   ·   ');
    db.data.messages.push({
      id: crypto.randomUUID(),
      mics,
      text,
      level: 'urgent',
      flash: true,
      targets,
      from: req.account.name,
      at: Date.now(),
      expiresAt: Date.now() + 45000,
      cleared: false,
    });
  } else delete wk.handhelds[ch];
  db.save();
  pushNow();
  log(`${ch} → ${name || '(cleared)'} by ${req.account.name}`);
  ok(res);
});

app.put('/api/wireless-receivers', auth.requireAdmin, (req, res) => {
  const ip = /^[A-Za-z0-9.-]{1,64}$/;
  const list = ((req.body || {}).receivers || [])
    .map((r) => ({ label: String(r.label || '').slice(0, 40), host: String(r.host || '').trim(), enabled: r.enabled !== false }))
    .filter((r) => r.host);
  if (list.some((r) => !ip.test(r.host))) return bad(res, 'Use the receiver’s IP address, like 192.168.10.60.');
  config.data.wireless = { ...(config.data.wireless || {}), receivers: list };
  config.saveNow();
  engine.restartWireless();
  log(`Wireless receivers updated by ${req.account.name}`);
  pushNow();
  ok(res);
});

// Display profiles + layouts
app.get('/api/profiles', auth.requireAdmin, (req, res) => ok(res, db.data.profiles));
app.put('/api/profiles/:id', auth.requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]{1,30}$/.test(id)) return bad(res, 'Profile ids are lowercase letters, numbers and dashes.');
  const b = req.body || {};
  const cur = db.data.profiles[id] || { name: id, modeSetting: 'auto', style: {}, layouts: { pre: { widgets: [] }, preshow: { widgets: [] }, live: { widgets: [] } } };
  db.data.profiles[id] = {
    ...cur,
    name: b.name ?? cur.name,
    location: b.location != null ? String(b.location).trim().slice(0, 40) || 'Other' : cur.location || 'Other',
    modeSetting: ['auto', 'pre', 'preshow', 'live'].includes(b.modeSetting) ? b.modeSetting : cur.modeSetting || 'auto',
    style: b.style ?? cur.style,
    layouts: b.layouts ?? cur.layouts,
  };
  db.save();
  pushNow();
  ok(res);
});
app.post('/api/profiles-mode', auth.requirePerm('live'), (req, res) => {
  const m = (req.body || {}).modeSetting;
  if (!['auto', 'pre', 'preshow', 'live'].includes(m)) return bad(res, 'Pick auto, pre, preshow or live.');
  for (const p of Object.values(db.data.profiles)) p.modeSetting = m;
  db.save();
  log(`All displays set to ${m} by ${req.account.name}`);
  pushNow();
  ok(res);
});

app.delete('/api/profiles/:id', auth.requireAdmin, (req, res) => {
  delete db.data.profiles[req.params.id];
  db.save();
  ok(res);
});

// Accounts
// Sign-in roles: names, which Planning Center positions count, what each can
// do, and its shared PIN (write-only).
// Permissions per role: any admin can change them. Only someone who can manage
// Roles & PINs can give or take that permission, or change a role that has it.
app.get('/api/role-perms', auth.requireAdmin, (req, res) => {
  ok(res, { perms: auth.PERMS, canRoles: auth.can(req.account, 'roles'), roles: (db.data.roles || []).map((r) => ({ id: r.id, name: r.name, perms: r.perms || [] })) });
});
app.put('/api/role-perms', auth.requireAdmin, (req, res) => {
  const want = (req.body || {}).perms || {};
  const canRoles = auth.can(req.account, 'roles');
  for (const r of db.data.roles || []) {
    if (!Array.isArray(want[r.id])) continue;
    const had = r.perms || [];
    if (!canRoles && had.includes('roles')) continue; // e.g. Technical Director
    let next = [...new Set(want[r.id].filter((p) => auth.PERMS.includes(p)))];
    if (!canRoles) next = next.filter((p) => p !== 'roles').concat(had.includes('roles') ? ['roles'] : []);
    r.perms = next;
  }
  db.save();
  log(`Role permissions changed by ${req.account.name}`);
  ok(res);
});

app.get('/api/roles', auth.requirePerm('roles'), (req, res) => {
  ok(res, { perms: auth.PERMS, roles: (db.data.roles || []).map((r) => ({ id: r.id, name: r.name, positions: r.positions || [], perms: r.perms || [], hasPin: !!r.pinHash, person: auth.scheduledFor(r.name) })) });
});
app.put('/api/roles', auth.requirePerm('roles'), (req, res) => {
  const incoming = (req.body || {}).roles || [];
  const old = Object.fromEntries((db.data.roles || []).map((r) => [r.id, r]));
  const next = [];
  for (const r of incoming) {
    const name = String(r.name || '').trim().slice(0, 40);
    if (!name) continue;
    const id = r.id && old[r.id] ? r.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(2).toString('hex');
    const role = { ...(old[id] || {}), id, name, positions: (r.positions || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10), perms: (r.perms || []).filter((x) => auth.PERMS.includes(x)) };
    if (r.pin) {
      if (!/^\d{4,8}$/.test(String(r.pin))) return bad(res, `The PIN for ${name} must be 4–8 digits.`);
      auth.setRolePin(role, String(r.pin));
    }
    next.push(role);
  }
  if (req.account.isRole && !next.some((r) => r.id === req.account.id.slice(5) && r.perms.includes('roles'))) return bad(res, 'You can’t remove your own access to Roles & PINs.');
  db.data.roles = next;
  // Signing out anyone in a role that was removed.
  for (const [t, sess] of Object.entries(db.data.sessions)) if (sess.roleId && !next.some((r) => r.id === sess.roleId)) delete db.data.sessions[t];
  db.save();
  log(`Roles updated by ${req.account.name}`);
  ok(res);
});

app.get('/api/accounts', auth.requirePerm('roles'), (req, res) => ok(res, db.data.accounts.map(auth.publicAccount)));
app.post('/api/accounts', auth.requirePerm('roles'), (req, res) => {
  const { name, pcoName, role, pin } = req.body || {};
  if (!name || !/^\d{4,8}$/.test(String(pin || ''))) return bad(res, 'Enter a name and a 4–8 digit PIN.');
  if (db.data.accounts.some((a) => a.name.toLowerCase() === String(name).toLowerCase())) return bad(res, 'There’s already an account with that name.');
  const a = auth.createAccount({ name, pcoName, role, pin });
  log(`Account created by ${req.account.name}: ${a.name} (${a.role})`);
  ok(res, { account: auth.publicAccount(a) });
});
app.put('/api/accounts/:id', auth.requirePerm('roles'), (req, res) => {
  const a = db.data.accounts.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Account not found.', 404);
  if (a.owner && req.account.id !== a.id) return bad(res, 'Only the overall administrator can change their own account.', 403);
  if (a.owner && req.body && req.body.role && req.body.role !== 'admin') return bad(res, 'The overall administrator stays an admin.');
  const b = req.body || {};
  if (b.name) a.name = String(b.name);
  if (b.pcoName) a.pcoName = String(b.pcoName);
  if (b.role) {
    if (a.role === 'admin' && b.role !== 'admin' && db.data.accounts.filter((x) => x.role === 'admin').length === 1) return bad(res, 'Keep at least one admin.');
    a.role = b.role === 'admin' ? 'admin' : 'leader';
  }
  if (b.pin) {
    if (!/^\d{4,8}$/.test(String(b.pin))) return bad(res, 'PINs are 4–8 digits.');
    const h = auth.hashPin(b.pin);
    a.salt = h.salt;
    a.pinHash = h.hash;
  }
  db.save();
  ok(res);
});
app.delete('/api/accounts/:id', auth.requirePerm('roles'), (req, res) => {
  const a = db.data.accounts.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Account not found.', 404);
  if (a.owner) return bad(res, 'The overall administrator account can’t be removed.', 403);
  if (a.role === 'admin' && db.data.accounts.filter((x) => x.role === 'admin').length === 1) return bad(res, 'Keep at least one admin.');
  db.data.accounts = db.data.accounts.filter((x) => x.id !== a.id);
  for (const [t, s] of Object.entries(db.data.sessions)) if (s.accountId === a.id) delete db.data.sessions[t];
  db.save();
  ok(res);
});

// Screens: every TV or output that has opened /display registers itself here
// so an admin can see it and move it to a different room.
app.get('/api/devices', auth.requireAdmin, (req, res) => {
  const live = new Set([...wss.clients].map((c) => c.device).filter(Boolean));
  ok(
    res,
    Object.entries(db.data.devices)
      .map(([id, d]) => ({ id, ...d, online: live.has(id) }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  );
});
app.put('/api/devices/:id', auth.requireAdmin, (req, res) => {
  const d = db.data.devices[req.params.id];
  if (!d) return bad(res, 'Screen not found.', 404);
  const b = req.body || {};
  if (b.name !== undefined) d.name = String(b.name).slice(0, 40);
  if (b.profile !== undefined) {
    if (!db.data.profiles[b.profile]) return bad(res, 'Unknown room.');
    d.profile = b.profile;
    let sent = false;
    for (const ws of wss.clients)
      if (ws.device === req.params.id && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'assign', profile: b.profile }));
        sent = true;
      }
    // Offline right now: switch it the next time it connects.
    if (sent) delete d.pendingProfile;
    else d.pendingProfile = b.profile;
  }
  db.save();
  ok(res);
});
app.delete('/api/devices/:id', auth.requireAdmin, (req, res) => {
  delete db.data.devices[req.params.id];
  db.save();
  ok(res);
});

// ---------- live push ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  ws.profile = u.searchParams.get('profile') || 'broadcast';
  const device = (u.searchParams.get('device') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  if (device) {
    ws.device = device;
    const known = db.data.devices[device] || {};
    // The room in the screen's own address wins, unless an admin moved this
    // screen while it was off; then it switches to that room now.
    if (!db.data.profiles[ws.profile] && REPLACED_PROFILES[ws.profile]) {
      ws.send(JSON.stringify({ type: 'assign', profile: REPLACED_PROFILES[ws.profile] }));
    } else if (known.pendingProfile && known.pendingProfile !== ws.profile && db.data.profiles[known.pendingProfile]) {
      ws.send(JSON.stringify({ type: 'assign', profile: known.pendingProfile }));
    }
    db.data.devices[device] = {
      name: known.name || u.searchParams.get('name') || 'Screen ' + device.slice(0, 4).toUpperCase(),
      profile: ws.profile,
      lastSeen: Date.now(),
      address: (req.socket.remoteAddress || '').replace('::ffff:', ''),
    };
    db.save();
  }
  sendTo(ws, engine.snapshot());
});

function sendTo(ws, snap) {
  const p = db.data.profiles[ws.profile];
  if (!p) return ws.send(JSON.stringify({ type: 'missing', profile: ws.profile }));
  // Midweek, every screen shows the shared Midweek dashboard (it keeps its
  // own identity, so Sunday it's straight back on its own dashboard).
  const mid = snap.midweek && ws.profile !== 'midweek' && db.data.profiles.midweek;
  const src = mid ? db.data.profiles.midweek : p;
  const mode = mid ? 'live' : snap.modes[ws.profile] || 'live';
  ws.send(
    JSON.stringify({
      type: 'snapshot',
      profile: { id: ws.profile, name: src.name, location: p.location || '', mode, style: src.style || {}, layout: src.layouts[mode] || src.layouts.live },
      snap,
    })
  );
}

function pushNow() {
  let snap;
  try {
    snap = engine.snapshot();
  } catch (e) {
    log('Snapshot failed: ' + e.stack);
    return;
  }
  for (const ws of wss.clients) if (ws.readyState === 1) sendTo(ws, snap);
}

setInterval(pushNow, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

const PORT = Number(process.env.PORT || config.data.port || 8080);

// TVs: power schedule, launching the dashboard app on each TV, and the video
// stream for the Roku TVs (see server/tvs.js and docs/TV-SETUP.md).
const streams = makeStreams({ config, log, port: PORT });
makeTvs({
  app,
  db,
  config,
  log,
  auth,
  streams,
  port: PORT,
  firstCallToday: () => engine.firstCallToday(),
  isOnline: (id) => [...wss.clients].some((c) => c.device === id && c.readyState === 1),
});
server.listen(PORT, '0.0.0.0', () => {
  log(`Love Church Displays running on port ${PORT} (${config.data.sampleMode ? 'sample mode' : 'live mode'})`);
  engine.startLoops();
});

process.on('uncaughtException', (e) => log('Uncaught: ' + e.stack));
process.on('unhandledRejection', (e) => log('Unhandled: ' + (e && e.stack ? e.stack : e)));
